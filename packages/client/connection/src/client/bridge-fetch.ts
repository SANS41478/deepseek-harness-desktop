/**
 * Shared IPC fetch leg: serialize one unary request into the preload bridge
 * with a minted correlation id, and forward caller abort as a separate cancel
 * message (the renderer's AbortSignal cannot cross IPC).
 *
 * @module @deepseek-ai/dsh-client-connection/client/bridge-fetch
 */

import type { DshApiBridge, DshFetchRequest, DshFetchResponse } from '../wire.ts'
import { randomUuid } from './random-uuid.ts'

/**
 * Send one unary fetch through the preload bridge, minting the request id the
 * main process cancels on. Faithful to real fetch: the returned promise
 * rejects on signal abort even when the bridge has not answered yet (the same
 * pattern the in-process client uses); the abort also tells the main process
 * to cancel the inflight request.
 * @param bridge - the preload-exposed `dshApi` surface.
 * @param request - the serialized request without the minted id.
 * @param signal - optional caller abort; the main side cancels the fetch.
 * @returns the serialized response.
 */
export function bridgeFetch(
  bridge: DshApiBridge,
  request: Omit<DshFetchRequest, 'requestId'>,
  signal?: AbortSignal,
): Promise<DshFetchResponse> {
  const requestId = randomUuid()
  const full: DshFetchRequest = { ...request, requestId }
  if (signal === undefined) return bridge.fetch(full)
  if (signal.aborted) {
    bridge.abort(requestId)
    return Promise.reject(abortError(signal))
  }
  return new Promise<DshFetchResponse>((resolve, reject) => {
    const onAbort = (): void => {
      bridge.abort(requestId)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    bridge.fetch(full)
      .then(resolve, reject)
      .finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

/** Mirror fetch's abort rejection: the signal's reason when present, else a DOMException-style AbortError. */
export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
