/**
 * `dsh://` protocol routing: the SPA entry injects the boot manifest, client
 * bundles delegate to the client-modules fetch handler, physical `/api/*`
 * GET/HEAD routes delegate to the same `toFetchHandler` the IPC bridge and
 * HTTP carrier wrap (the export response streams), and everything else serves
 * dist assets with traversal and loud-404 guards.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import {
  registerDshScheme,
  routeDshRequest,
  type DshProtocolDeps,
  type DesktopClientModules,
} from '../src/main/protocol.ts'

const electronModule = vi.hoisted(() => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}))

vi.mock('electron', () => electronModule)

let tempRoot = ''

afterEach(async () => {
  if (tempRoot !== '') {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = ''
  }
  vi.clearAllMocks()
})

/** Build a self-contained dep set over a temp dist directory. */
async function makeDeps(overrides?: {
  apiHandler?: DshProtocolDeps['apiHandler']
  modules?: DesktopClientModules
}): Promise<{ dir: string; deps: DshProtocolDeps }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-protocol-'))
  tempRoot = dir
  await writeFile(join(dir, 'index.html'), '<head></head><body>app</body>')
  await writeFile(join(dir, 'app.js'), 'console.log(1)')
  const modules: DesktopClientModules = overrides?.modules ?? {
    graph: () => ({ entries: [], meta: { batch: 'test' } } as unknown as WebBootGraph),
    serveBundleFetch: async request => new Response(`bundle:${new URL(request.url).pathname}`, { status: 200 }),
  }
  return {
    dir,
    deps: {
      distIndex: join(dir, 'index.html'),
      distRoot: dir,
      modules,
      apiHandler: overrides?.apiHandler,
    },
  }
}

/** A fetch handler that streams two chunks for /api/session.export. */
function streamingApiHandler(): DshProtocolDeps['apiHandler'] {
  const exportHeaders = {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename=export.log',
  }
  return {
    async fetch(request) {
      const requestUrl = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      const path = new URL(requestUrl).pathname
      if (path !== '/api/session.export') return new Response('not found', { status: 404 })
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: exportHeaders })
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk one;'))
          controller.enqueue(new TextEncoder().encode('chunk two'))
          controller.close()
        },
      }), { headers: exportHeaders })
    },
  }
}

describe('registerDshScheme', () => {
  it('registers dsh:// as a standard, secure, fetchable, streaming origin', () => {
    registerDshScheme()
    expect(electronModule.protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([{
      scheme: 'dsh',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    }])
  })
})

describe('routeDshRequest', () => {
  it('serves the SPA entry with the boot manifest injected', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/'), deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('window.__DSH_BOOT__')
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('delegates client bundles to the client-modules fetch handler', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/plugins/ui-session/client.js'), deps)
    expect(await response.text()).toBe('bundle:/plugins/ui-session/client.js')
  })

  it('streams /api/session.export GET through the API handler, chunk by chunk', async () => {
    const { deps } = await makeDeps({ apiHandler: streamingApiHandler() })
    const response = await routeDshRequest(new Request('dsh://app/api/session.export?sessionId=s1'), deps)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename=export.log')
    expect(await response.text()).toBe('chunk one;chunk two')
  })

  it('forwards /api/session.export HEAD to the API handler for the download preflight', async () => {
    const { deps } = await makeDeps({ apiHandler: streamingApiHandler() })
    const response = await routeDshRequest(new Request('dsh://app/api/session.export?sessionId=s1', { method: 'HEAD' }), deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('passes unknown /api/* GET to the API handler, which reports 404', async () => {
    const { deps } = await makeDeps({ apiHandler: streamingApiHandler() })
    const response = await routeDshRequest(new Request('dsh://app/api/nope'), deps)
    expect(response.status).toBe(404)
  })

  it('never routes /api/* POST through the API handler (unary rides the bridge)', async () => {
    const fetchSpy = vi.fn(streamingApiHandler()!.fetch)
    const { deps } = await makeDeps({ apiHandler: { fetch: fetchSpy } })
    const response = await routeDshRequest(new Request('dsh://app/api/session.export', { method: 'POST' }), deps)
    expect(response.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls through to 404 when the tree has no API handler', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/api/session.export?sessionId=s1'), deps)
    expect(response.status).toBe(404)
  })

  it('serves dist assets with their MIME type', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/app.js'), deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('console.log(1)')
    expect(response.headers.get('content-type')).toContain('text/javascript')
  })

  it('neutralizes encoded-dot traversal attempts', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/%2e%2e/secrets.txt'), deps)
    expect(response.status).toBe(404)
  })

  it('reports 404 for a missing asset', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/missing.js'), deps)
    expect(response.status).toBe(404)
  })

  it('rejects an undecodable path', async () => {
    const { deps } = await makeDeps()
    const response = await routeDshRequest(new Request('dsh://app/%E0%A4%A'), deps)
    expect(response.status).toBe(400)
  })
})
