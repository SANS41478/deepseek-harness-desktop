/**
 * Renderer-side IPC carrier: the `AbstractApiClient` subclass for the desktop
 * shell's IPC transport. Protocol invariants stay in the base class; this
 * subclass supplies the transport aspect (`doFetch` → preload bridge) and the
 * two downlink stream openers (mux / host → pushed frames), mirroring the
 * browser's `WebApiClient` exactly — the frame parsing, envelope taps, and
 * rpcId discipline are unchanged.
 *
 * The connection apply selects this carrier when the boot-time transport fact
 * marks the page as an Electron IPC page and the preload bridge is present
 * (see `src/client/index.ts`); plain browser pages stay on `WebApiClient`.
 *
 * @module @deepseek-ai/dsh-client-connection/client/electron-api-client
 */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import type { DshApiBridge, DshStreamChannel, DshStreamMessage } from '../wire.ts'

type Parser<F> = { parse(value: unknown): F }

/**
 * IPC-platform subclass: unary/respond use the preload fetch bridge; mux/host
 * consume the main-process stream pumps.
 */
export class ElectronApiClient extends AbstractApiClient {
  /**
   * @param bridge - the preload-exposed `dshApi` surface.
   * @param timeoutMs - bounded unary timeout; defaults to the base value.
   */
  constructor(
    private readonly bridge: DshApiBridge,
    timeoutMs?: number,
  ) {
    super(timeoutMs)
  }

  /** Transport aspect: serialize the fetch into the IPC bridge. The
   *  renderer's AbortSignal is deliberately dropped (it cannot cross IPC). */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return this.bridge.fetch({
      url: input.toString(),
      ...init?.method !== undefined ? { method: init.method } : {},
      ...init?.headers !== undefined ? { headers: init.headers as Record<string, string> } : {},
      ...typeof init?.body === 'string' ? { body: init.body } : {},
    }).then(({ ok, status, bodyText }) => new Response(ok ? bodyText : null, { status }))
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readStream('mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readStream('host', signal, hostFrameSchema, onOpen)
  }

  /** Read one pushed stream: subscribe to the channel, parse each pushed
   *  full-form ServerRequest with the shared schemas, and yield the narrow
   *  frame. `stream-end` closes the iteration; abort unsubscribes. */
  private async *readStream<F extends MuxFrame | HostFrame>(
    channel: DshStreamChannel,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const inbox: DshStreamMessage[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: DshStreamMessage): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const unsubscribe = this.bridge.subscribe(channel, enqueue)
    const onAbort = (): void => { enqueue({ type: 'stream-end' }) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    // The bridge subscription is synchronous, so the stream is established
    // immediately (the browser carrier fires onOpen once its socket opens).
    onOpen?.()
    try {
      while (true) {
        while (inbox.length > 0) {
          const message = inbox.shift() as DshStreamMessage
          if (message.type === 'stream-end') return
          let full: ServerRequest
          let frame: F
          try {
            full = serverRequestSchema.parse(message)
            frame = frameSchema.parse(full.payload)
          } catch (error) {
            // One corrupt frame must not kill the stream; the client's gap
            // detection covers whatever the frame carried (browser parity).
            console.error(`[dsh-client-connection] dropping malformed frame on ${channel}:`, error)
            continue
          }
          this.onEnvelope(full)
          yield { rpcId: full.rpcId, payload: frame }
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }
}
