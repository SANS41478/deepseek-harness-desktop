/**
 * Cross-process wire contract between the Electron renderer and the main
 * process. Plain JSON only (structured-clone boundaries): no DOM, Node, or
 * Cordis types cross the IPC channel. Shared by the preload bridge, the
 * renderer's {@link ElectronApiClient}, and the main-process IPC handler.
 *
 * @module @deepseek-ai/dsh-desktop/shared/dsh-api
 */

/** One unary fetch request the renderer sends over IPC. */
export interface DshFetchRequest {
  /** Absolute URL, including the path (the `/api/<method>` segment). */
  url: string
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
   * @param request - the serialized request.
   * @returns the serialized response.
   */
  fetch(request: DshFetchRequest): Promise<DshFetchResponse>

  /**
   * Subscribe to one event stream.
   * @param channel - which downlink to follow.
   * @param onMessage - per-frame callback; `stream-end` is the last message.
   * @returns the unsubscriber (also tells the main process to stop the pump).
   */
  subscribe(channel: DshStreamChannel, onMessage: (message: DshStreamMessage) => void): () => void
}
