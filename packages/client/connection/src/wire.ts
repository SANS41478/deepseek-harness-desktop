/**
 * Cross-process wire contract between an Electron renderer and the main
 * process. Plain JSON only (structured-clone boundaries): no DOM, Node, or
 * Cordis types cross the IPC channel. Shared by the desktop preload bridge,
 * the renderer's {@link ElectronApiClient}, and the main-process IPC handler.
 *
 * Lives in this package (not in the shell) so the renderer's browser bundle
 * and the shell's Node half read one contract; both halves import type-only
 * from this module.
 *
 * @module @deepseek-ai/dsh-client-connection/wire
 */

/** One unary fetch request the renderer sends over IPC. */
export interface DshFetchRequest {
  /** Absolute URL, including the path (the `/api/<method>` segment). */
  url: string
  /**
   * The renderer-minted correlation id: the main process keeps an abort
   * controller per inflight id and cancels it on `DshApiBridge.abort`.
   */
  requestId: string
  /** HTTP method; absent means GET. */
  method?: string
  /** Plain header map; absent means none. */
  headers?: Record<string, string>
  /** JSON body text; absent means none. */
  body?: string
}

/** The serialized fetch response the main process returns. */
export interface DshFetchResponse {
  /** Whether the carrier call succeeded (the wire result rides the body either way). */
  ok: boolean
  /** HTTP status of the carrier response. */
  status: number
  /** Response headers (the RPC envelope consumer reads none of them today). */
  headers: Record<string, string>
  /** The response body, fully buffered (unary RPC bodies are small JSON). */
  bodyText: string
}

/** The two server-to-renderer event streams (the mux and host downlinks). */
export type DshStreamChannel = 'mux' | 'host'

/**
 * One pushed stream message: a full-form ServerRequest frame (parsed by the
 * renderer with the shared zod schemas, mirroring the WebSocket carrier) or
 * the terminal `stream-end` marker the main process sends when the pump ends.
 */
export type DshStreamMessage =
  | {
    type: 'server-request'
    rpcId: string
    /** The frame type (`session/event`, `subagent.started`, ...). */
    method: string
    /** The raw frame payload, validated by the renderer's frame schema. */
    payload: unknown
  }
  | { type: 'stream-end' }

/** The preload-exposed surface the renderer carrier consumes. */
export interface DshApiBridge {
  /**
   * Send one unary fetch through the main process.
   * @param request - the serialized request (carries the correlation id).
   * @returns the serialized response.
   */
  fetch(request: DshFetchRequest): Promise<DshFetchResponse>

  /**
   * Cancel one inflight fetch: the main process aborts the request's signal.
   * The renderer's AbortSignal cannot cross IPC, so the caller correlates a
   * separate cancel message through the request id it minted.
   * @param requestId - the id the original request carried.
   */
  abort(requestId: string): void

  /**
   * Subscribe to one event stream.
   * @param channel - which downlink to follow.
   * @param onMessage - per-frame callback; `stream-end` is the last message.
   * @returns the unsubscriber (also tells the main process to stop the pump).
   */
  subscribe(channel: DshStreamChannel, onMessage: (message: DshStreamMessage) => void): () => void
}
