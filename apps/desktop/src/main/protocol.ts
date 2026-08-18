/**
 * `dsh://` custom protocol for the IPC transport mode. Replaces the browser
 * HTTP carrier's static serving: the protocol handler serves the built
 * `dsh-web-frontend` dist (index.html with the boot manifest injected, plus
 * its assets) and the client-plugin bundles. The bundle surface rides
 * `ClientModuleRegistry.serveBundleFetch`, the same fetch-shaped handler the
 * HTTP carrier wraps, so both carriers share one implementation. The physical
 * GET/HEAD API routes (`/api/session.export`) ride `toFetchHandler`, the same
 * handler the IPC bridge and the HTTP carrier wrap — the export response
 * streams chunked to the renderer's download.
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
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'

/** The client-modules face the desktop reads (graph composition + bundle serving). */
export interface DesktopClientModules {
  graph(): WebBootGraph
  serveBundleFetch(request: Request): Promise<Response>
}

/** The fetch-shaped handler produced by `toFetchHandler` (apiProxy absent → undefined). */
type FetchHandler = { fetch: typeof fetch }

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

/** The deps `routeDshRequest` needs (injected by `registerDshProtocol`). */
export interface DshProtocolDeps {
  /** Path of the built `dsh-web-frontend` index.html. */
  distIndex: string
  /** Directory containing the dist assets. */
  distRoot: string
  /** The client-modules face (graph + bundle serving). */
  modules: DesktopClientModules
  /** The fetch-shaped API handler for `/api/*`; absent when the tree is carrier-free. */
  apiHandler?: FetchHandler | undefined
}

/**
 * Route one `dsh://` request: SPA entry, client bundles, physical API
 * GET/HEAD routes, then dist assets. Pure with respect to Electron so the
 * routing rules run in Node tests.
 * @param request - the protocol request.
 * @param deps - the dist paths, modules face, and optional API handler.
 * @returns the response to stream back to the renderer.
 */
export async function routeDshRequest(request: Request, deps: DshProtocolDeps): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }

  // SPA entry: inject the boot manifest into the dist index (the same
  // transform the client-modules index tap applies in the browser carrier).
  if (pathname === '/' || pathname === '/index.html') {
    const html = await readFile(deps.distIndex, 'utf8')
    return new Response(injectBootManifest(html, deps.modules.graph()), {
      headers: { 'content-type': MIME['.html'] ?? 'text/html; charset=utf-8' },
    })
  }

  // Client-plugin bundles and their source maps: `/plugins/<id>/client.js`.
  // The client-modules fetch handler owns the path resolution, MIME, and
  // loud-404 semantics — the same handler the HTTP carrier wraps.
  if (pathname.startsWith('/plugins/')) {
    return deps.modules.serveBundleFetch(request)
  }

  // Physical API routes (`/api/session.export`): same `toFetchHandler` the
  // IPC bridge and HTTP carrier wrap. GET/HEAD only — the renderer's unary
  // RPC rides the bridge, and the download flow needs exactly these two. The
  // reconstructed Request carries the protocol's abort signal, so canceling
  // the renderer fetch aborts the handler-side work.
  if (pathname.startsWith('/api/') && (request.method === 'GET' || request.method === 'HEAD') && deps.apiHandler !== undefined) {
    return deps.apiHandler.fetch(new Request(new URL(request.url), {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
    }))
  }

  // Dist assets (vite emits them under /assets with hashed names). The URL
  // parser already normalizes dot segments before this branch, so the guard is
  // defense-in-depth against a future decode-before-parse refactor.
  const assetPath = join(deps.distRoot, pathname)
  if (!assetPath.startsWith(deps.distRoot)) return new Response('forbidden', { status: 403 })
  try {
    const body = await readFile(assetPath)
    const extension = extnameOf(pathname)
    return new Response(body, { headers: { 'content-type': MIME[extension] ?? 'application/octet-stream' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
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
  const api = ctx.get('apiProxy') as unknown
  const apiHandler = api === undefined ? undefined : toFetchHandler(api as never)
  const distIndex = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  const distRoot = dirname(distIndex)

  protocol.handle(SCHEME, request => routeDshRequest(request, { distIndex, distRoot, modules, apiHandler }))
}

/** The last path extension, or an empty string when the path has none. */
function extnameOf(pathname: string): string {
  const slash = pathname.lastIndexOf('/')
  const base = slash === -1 ? pathname : pathname.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
}
