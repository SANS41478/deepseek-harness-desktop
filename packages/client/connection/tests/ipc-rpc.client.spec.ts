/**
 * IPC generic RPC caller: the preload bridge is the transport, correlation and
 * envelope validation stay, and the invalid-target fence matches the browser
 * caller exactly.
 */
import { describe, expect, it, vi } from 'vitest'
import { createIpcConnectionRpc } from '../src/client/ipc-rpc.ts'
import type { DshApiBridge, DshFetchRequest, DshFetchResponse } from '../src/wire.ts'

class FakeBridge implements DshApiBridge {
  readonly calls: DshFetchRequest[] = []
  readonly aborted: string[] = []
  onFetch: (request: DshFetchRequest) => Promise<DshFetchResponse> = () => Promise.resolve({
    ok: true, status: 200, headers: {}, bodyText: '{}',
  })
  fetch(request: DshFetchRequest): Promise<DshFetchResponse> {
    this.calls.push(request)
    return this.onFetch(request)
  }
  abort(requestId: string): void {
    this.aborted.push(requestId)
  }
  subscribe(): () => void { return () => {} }
}

describe('createIpcConnectionRpc', () => {
  it('carries a call through the bridge with a correlated envelope', async () => {
    const bridge = new FakeBridge()
    bridge.onFetch = (request) => {
      const body = JSON.parse(request.body ?? '{}') as { rpcId: string }
      return Promise.resolve({
        ok: true, status: 200, headers: {},
        bodyText: JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: true, value: { ref: 'goal-1' } },
        }),
      })
    }
    const rpc = createIpcConnectionRpc(bridge)
    await expect(rpc.call('/api', 'goals/create', { args: { agentId: 'agent-1' } }))
      .resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })
    expect(bridge.calls).toHaveLength(1)
    expect(bridge.calls[0]).toMatchObject({ url: '/api/goals/create', method: 'POST' })
    const body = JSON.parse(bridge.calls[0]!.body ?? '{}') as { type: string; method: string }
    expect(body).toMatchObject({ type: 'client-request', method: 'goals/create' })
  })

  it('throws on transport failure and rpcId mismatch', async () => {
    const bridge = new FakeBridge()
    const rpc = createIpcConnectionRpc(bridge)
    bridge.onFetch = () => Promise.resolve({ ok: false, status: 503, headers: {}, bodyText: 'unavailable' })
    await expect(rpc.call('/api', 'goals/create', {})).rejects.toThrow('HTTP 503')

    bridge.onFetch = () => Promise.resolve({
      ok: true, status: 200, headers: {},
      bodyText: JSON.stringify({
        type: 'server-response',
        rpcId: 'different-rpc',
        result: { ok: true, value: null },
      }),
    })
    await expect(rpc.call('/api', 'goals/create', {})).rejects.toThrow('rpcId mismatch')
  })

  it('rejects invalid targets before touching the bridge', async () => {
    const bridge = new FakeBridge()
    const rpc = createIpcConnectionRpc(bridge)
    for (const [channel, endpoint] of [
      ['api2', 'goals/create'],
      ['/api/path', 'goals/create'],
      ['/api', ''],
      ['/api', '.'],
      ['/api', '..'],
      ['/api', 'goals//create'],
      ['/api', 'goals/create?unsafe'],
    ] as const) {
      await expect(rpc.call(channel, endpoint, {})).rejects.toThrow('invalid RPC target')
    }
    expect(bridge.calls).toHaveLength(0)
  })

  it('mints a request id and forwards caller abort as a cancel message', async () => {
    const bridge = new FakeBridge()
    const rpc = createIpcConnectionRpc(bridge)
    const abort = new AbortController()
    bridge.onFetch = vi.fn((request: DshFetchRequest) => Promise.resolve({
      ok: true, status: 200, headers: {},
      bodyText: JSON.stringify({
        type: 'server-response',
        rpcId: (JSON.parse(request.body ?? '{}') as { rpcId: string }).rpcId,
        result: { ok: true, value: null },
      }),
    }))
    const pending = rpc.call('/api', 'goals/create', {}, abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow('This operation was aborted')
    expect(bridge.calls[0]).not.toHaveProperty('signal')
    expect(bridge.calls[0]?.requestId).toBeTypeOf('string')
    expect(bridge.aborted).toEqual([bridge.calls[0]?.requestId])
  })

  it('resolves without aborting when the caller signal never fires', async () => {
    const bridge = new FakeBridge()
    const rpc = createIpcConnectionRpc(bridge)
    bridge.onFetch = request => Promise.resolve({
      ok: true, status: 200, headers: {},
      bodyText: JSON.stringify({
        type: 'server-response',
        rpcId: (JSON.parse(request.body ?? '{}') as { rpcId: string }).rpcId,
        result: { ok: true, value: null },
      }),
    })
    await expect(rpc.call('/api', 'goals/create', {}, new AbortController().signal))
      .resolves.toMatchObject({ ok: true })
    expect(bridge.calls[0]?.requestId).toBeTypeOf('string')
    expect(bridge.aborted).toHaveLength(0)
  })
})
