/** IPC-backed caller for generic Connection unary RPC channels. */

import {
  RpcId,
  serverResponseSchema,
  type ClientRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientConnectionRpc } from '../rpc.ts'
import type { DshApiBridge } from '../wire.ts'
import { bridgeFetch } from './bridge-fetch.ts'
import { randomUuid } from './random-uuid.ts'

const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Create the Electron IPC-backed generic RPC caller: the mirror of
 * `createWebConnectionRpc` that rides the preload bridge instead of
 * `globalThis.fetch`, so goal remotes and every generic channel reach the
 * main process on `dsh://` pages.
 * @param bridge - the preload-exposed `dshApi` surface.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createIpcConnectionRpc(bridge: DshApiBridge): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      // The renderer's AbortSignal does not cross IPC: `bridgeFetch` mints a
      // request id and forwards abort as a separate cancel message, exactly
      // like the unary carrier.
      const response = await bridgeFetch(bridge, {
        url: `${channel}/${endpoint}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      }, signal)
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const full = serverResponseSchema.parse(JSON.parse(response.bodyText))
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}

function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
