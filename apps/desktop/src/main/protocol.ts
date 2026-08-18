/**
 * `dsh://` custom protocol for the IPC transport mode. Replaces the browser
 * HTTP carrier's static serving: the protocol handler serves the built
 * `dsh-web-frontend` dist (index.html with the boot manifest injected, plus
 * its assets) and the client-plugin bundles. The bundle surface rides
 * `ClientModuleRegistry.serveBundleFetch`, the same fetch-shaped handler the
 * HTTP carrier wraps, so both carriers share one implementation.
 *
 * Registering the scheme as privileged must happen before the app is ready;
 * the handler installs after.
 *
 * @module @deepseek-ai/dsh-desktop/main/protocol
 */

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { protocol } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { injectBootManifest, type WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** The client-modules face the desktop reads (graph composition + bundle serving). */
interface DesktopClientModules {
  graph(): WebBootGraph
  serveBundleFetch(request: Request): Promise<Response>
}

const SCHEME = 'dsh'

/** The scheme privileges a standard secure origin needs for module scripts and fetch. */
export function registerDshScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** MIME types for the handful of extensions the dist and bundles emit. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Install the protocol handler over one settled host context. Call after
 * `app.whenReady()`.
 * @param ctx - the settled desktop host context (clientModules must exist).
 */
export function registerDshProtocol(ctx: Context): void {
  const modules = ctx.get('clientModules') as DesktopClientModules | undefined
  if (modules === undefined) {
    throw new Error('dsh-desktop: clientModules service missing — the IPC transport requires the web composition')
  }
  const distIndex = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  const distRoot = dirname(distIndex)

  protocol.handle(SCHEME, async (request) => {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('bad request', { status: 400 })
    }

    // SPA entry: inject the boot manifest into the dist index (the same
    // transform the client-modules index tap applies in the browser carrier).
    if (pathname === '/' || pathname === '/index.html') {
      const html = await readFile(distIndex, 'utf8')
      return new Response(injectBootManifest(html, modules.graph()), {
        headers: { 'content-type': MIME['.html'] ?? 'text/html; charset=utf-8' },
      })
    }

    // Client-plugin bundles and their source maps: `/plugins/<id>/client.js`.
    // The client-modules fetch handler owns the path resolution, MIME, and
    // loud-404 semantics — the same handler the HTTP carrier wraps.
    if (pathname.startsWith('/plugins/')) {
      return modules.serveBundleFetch(request)
    }

    // Dist assets (vite emits them under /assets with hashed names).
    const assetPath = join(distRoot, pathname)
    if (!assetPath.startsWith(distRoot)) return new Response('forbidden', { status: 403 })
    try {
      const body = await readFile(assetPath)
      const extension = extnameOf(pathname)
      return new Response(body, { headers: { 'content-type': MIME[extension] ?? 'application/octet-stream' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/** The last path extension, or an empty string when the path has none. */
function extnameOf(pathname: string): string {
  const slash = pathname.lastIndexOf('/')
  const base = slash === -1 ? pathname : pathname.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
}
