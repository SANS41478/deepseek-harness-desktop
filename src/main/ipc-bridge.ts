/**
 * Main-process IPC carrier for the desktop renderer (IPC transport mode).
 *
 * The RPC protocol contract is unchanged: the main process owns the harness's
 * {@link ApiProxy} and wraps it with `toFetchHandler`, the same fetch-shaped
 * handler the browser HTTP bridge uses — the desktop just reaches it over
 * IPC instead of a socket. Unary calls and `respond` ride
 * `ipcMain.handle('dsh:fetch')`; the two event streams (mux / host) are
 * pumped in the main process and pushed to the renderer as frames.
 *
 * Known gaps (documented in the README): the renderer's AbortSignal does not
 * cross IPC (unary cancellation degrades to main-side completion), and
 * `/api/session.export` bodies are not yet chunked over IPC.
 *
 * @module @deepseek-ai/dsh-desktop/main/ipc-bridge
 */

import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { RpcId, type MuxFrame, type HostFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  DshFetchRequest,
  DshFetchResponse,
  DshStreamChannel,
  DshStreamMessage,
} from '../shared/dsh-api.ts'

/** The ApiProxy face the host provides under the `apiProxy` service key. */
interface DesktopApiProxy {
  events: {
    mux(request: { rpcId: RpcId; payload: Record<string, never> }, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: MuxFrame }>
    host(request: { rpcId: RpcId; payload: Record<string, never> }, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: HostFrame }>
  }
}

/** The fetch-shaped handler produced by `toFetchHandler`. */
type FetchHandler = { fetch(request: Request): Promise<Response> }

interface StreamPump {
  abort(): void
}

/**
 * Install the IPC carrier over one settled host context, pushing the mux and
 * host streams into the given window.
 * @param ctx - the settled desktop host context.
 * @param webContents - the window's web contents receiving stream frames.
 * @returns a disposer that removes the IPC handlers and stops the pumps.
 */
export function installIpcBridge(ctx: Context, webContents: WebContents): () => void {
  const api = ctx.get('apiProxy') as DesktopApiProxy | undefined
  if (api === undefined) {
    throw new Error('dsh-desktop: apiProxy service missing — the IPC carrier requires the web composition')
  }
  const fetchHandler: FetchHandler = toFetchHandler(api as never)

  ipcMain.handle('dsh:fetch', async (_event, request: DshFetchRequest): Promise<DshFetchResponse> => {
    const response = await fetchHandler.fetch(new Request(new URL(request.url), {
      method: request.method ?? 'GET',
      ...request.headers !== undefined ? { headers: request.headers } : {},
      ...request.body !== undefined ? { body: request.body } : {},
    }))
    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText: await response.text(),
    }
  })

  const pumps = new Map<DshStreamChannel, StreamPump>()
  const onClose = (_event: IpcMainEvent, channel: unknown): void => {
    if (channel === 'mux' || channel === 'host') pumps.get(channel)?.abort()
  }
  ipcMain.on('dsh:stream:close', onClose)

  /** Pump one downlink: the abort controller is BOTH the pump's cancel and the
   *  signal passed to the events stream, so an abort stops the iteration. */
  const startPump = (
    channel: DshStreamChannel,
    open: (signal: AbortSignal) => AsyncIterable<{ rpcId: string; payload: MuxFrame | HostFrame }>,
  ): void => {
    const controller = new AbortController()
    pumps.set(channel, { abort: () => controller.abort() })
    void (async () => {
      try {
        for await (const frame of open(controller.signal)) {
          if (controller.signal.aborted || webContents.isDestroyed()) return
          const message: DshStreamMessage = {
            type: 'server-request',
            rpcId: frame.rpcId,
            method: frame.payload.type,
            payload: frame.payload,
          }
          webContents.send(`dsh:stream:${channel}`, message)
        }
      } catch (error) {
        // The fetch handler already emits a stream/error frame for impl
        // failures; reaching here means the pump aborted or the window died.
        console.error(`dsh-desktop: ${channel} stream pump ended with an error:`, error)
      } finally {
        if (!webContents.isDestroyed()) {
          webContents.send(`dsh:stream:${channel}`, { type: 'stream-end' } satisfies DshStreamMessage)
        }
        pumps.delete(channel)
      }
    })()
  }

  startPump('mux', signal => api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, signal))
  startPump('host', signal => api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, signal))

  return () => {
    ipcMain.removeHandler('dsh:fetch')
    ipcMain.removeListener('dsh:stream:close', onClose)
    for (const pump of pumps.values()) pump.abort()
    pumps.clear()
  }
}
