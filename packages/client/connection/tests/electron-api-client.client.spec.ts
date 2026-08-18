/**
 * Electron IPC carrier semantics: the preload bridge becomes the transport —
 * unary/respond serialize through `bridge.fetch`, mux/host subscribe to the
 * pushed stream channels with the shared frame schemas, and abort ends the
 * iteration by unsubscribing. Mirrors the WebApiClient contract over the IPC
 * surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcMessage } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import { abortError } from '../src/client/bridge-fetch.ts'
import { ElectronApiClient } from '../src/client/electron-api-client.ts'
import type {
  DshApiBridge,
  DshFetchRequest,
  DshFetchResponse,
  DshStreamChannel,
  DshStreamMessage,
} from '../src/wire.ts'

/** Test-held bridge: the case drives fetch responses and pushed frames. */
class FakeBridge implements DshApiBridge {
  readonly fetchCalls: DshFetchRequest[] = []
  readonly aborted: string[] = []
  readonly subscribed: DshStreamChannel[] = []
  readonly unsubscribed: DshStreamChannel[] = []
  /** Per-channel enqueue handles, assigned on subscribe. */
  private enqueuers = new Map<DshStreamChannel, (message: DshStreamMessage) => void>()

  onFetch: (request: DshFetchRequest) => Promise<DshFetchResponse> = () => Promise.resolve({
    ok: true, status: 200, headers: {}, bodyText: '{}',
  })

  fetch(request: DshFetchRequest): Promise<DshFetchResponse> {
    this.fetchCalls.push(request)
    return this.onFetch(request)
  }

  abort(requestId: string): void {
    this.aborted.push(requestId)
  }

  subscribe(channel: DshStreamChannel, onMessage: (message: DshStreamMessage) => void): () => void {
    this.subscribed.push(channel)
    this.enqueuers.set(channel, onMessage)
    return () => {
      this.unsubscribed.push(channel)
      this.enqueuers.delete(channel)
    }
  }

  push(channel: DshStreamChannel, message: DshStreamMessage): void {
    this.enqueuers.get(channel)?.(message)
  }
}

const originalWebSocket = globalThis.WebSocket

afterEach(() => {
  if (originalWebSocket === undefined) delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  else globalThis.WebSocket = originalWebSocket
})

describe('ElectronApiClient', () => {
  it('routes unary calls and respond through bridge.fetch with the serialized envelope', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const original = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (input: URL | RequestInfo) => {
      seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }
    bridge.onFetch = (request) => {
      expect(request.url).toContain('/api/host.describe')
      expect(request.method).toBe('POST')
      const body = JSON.parse(request.body ?? '{}') as { type: string; rpcId: string }
      expect(body.type).toBe('client-request')
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: {},
        bodyText: JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: true, value: { version: '0-ipc', cwd: '/d', attachedSessions: 0, canOpenPath: true } },
        }),
      })
    }
    try {
      const response = await client.host.describe({})
      expect(response.result).toMatchObject({ ok: true, value: { canOpenPath: true } })
      expect(seen).toHaveLength(0) // the IPC carrier never touches globalThis.fetch
    } finally {
      globalThis.fetch = original
    }
  })

  it('responds over the bridge with the client-response envelope', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    bridge.onFetch = (request) => {
      expect(request.url).toContain('/api/respond')
      const body = JSON.parse(request.body ?? '{}') as { type: string; rpcId: string }
      expect(body.type).toBe('client-response')
      // The respond receipt is the response body itself (not an envelope).
      return Promise.resolve({
        ok: true, status: 200, headers: {},
        bodyText: JSON.stringify({ accepted: true }),
      })
    }
    const receipt = await client.respond({
      type: 'client-response',
      rpcId: RpcId('r'),
      result: { ok: true, value: {} },
    })
    expect(receipt).toEqual({ accepted: true })
  })

  it('surfaces a non-2xx bridge response as a transport failure', async () => {
    const bridge = new FakeBridge()
    bridge.onFetch = () => Promise.resolve({ ok: false, status: 503, headers: {}, bodyText: 'unavailable' })
    const client = new ElectronApiClient(bridge)
    await expect(client.host.describe({})).rejects.toThrow('HTTP 503')
  })

  it('serializes only the present init fields when the transport call omits method/headers/body', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    // White-box: exercise doFetch directly with a bare init (the stream
    // openers are overridden, so no business path reaches this shape).
    const doFetch = (client as unknown as {
      doFetch(input: URL, init?: RequestInit): Promise<Response>
    }).doFetch.bind(client)
    const response = await doFetch(new URL('http://dsh.internal/api/events.mux'), {})
    expect(response.ok).toBe(true)
    expect(bridge.fetchCalls[0]).toMatchObject({ url: 'http://dsh.internal/api/events.mux' })
    expect(bridge.fetchCalls[0]).not.toHaveProperty('method')
    expect(bridge.fetchCalls[0]).not.toHaveProperty('headers')
    expect(bridge.fetchCalls[0]).not.toHaveProperty('body')
    expect(bridge.fetchCalls[0]?.requestId).toBeTypeOf('string')
    expect(bridge.aborted).toHaveLength(0)
  })

  it('rejects when the caller aborts mid-flight and tells the bridge to cancel', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const abort = new AbortController()
    let release: (() => void) | undefined
    bridge.onFetch = () => new Promise((resolve) => { release = () =>{  resolve({ ok: true, status: 200, headers: {}, bodyText: '{}' }) } })
    const doFetch = (client as unknown as {
      doFetch(input: URL, init?: RequestInit): Promise<Response>
    }).doFetch.bind(client)
    const pending = doFetch(new URL('http://dsh.internal/api/events.mux'), { signal: abort.signal })
    abort.abort()
    await expect(pending).rejects.toThrow('This operation was aborted')
    expect(bridge.aborted).toEqual([bridge.fetchCalls[0]?.requestId])
    release?.()
  })

  it('rejects immediately on an already-aborted signal without touching the bridge', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const abort = new AbortController()
    abort.abort()
    const doFetch = (client as unknown as {
      doFetch(input: URL, init?: RequestInit): Promise<Response>
    }).doFetch.bind(client)
    await expect(doFetch(new URL('http://dsh.internal/api/events.mux'), { signal: abort.signal }))
      .rejects.toThrow('This operation was aborted')
    expect(bridge.fetchCalls).toHaveLength(0)
    expect(bridge.aborted).toHaveLength(1)
  })

  it('rejects with the bridge failure and keeps the caller signal wiring intact', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const failure = new Error('bridge died')
    bridge.onFetch = () => Promise.reject(failure)
    const doFetch = (client as unknown as {
      doFetch(input: URL, init?: RequestInit): Promise<Response>
    }).doFetch.bind(client)
    const abort = new AbortController()
    await expect(doFetch(new URL('http://dsh.internal/api/events.mux'), { signal: abort.signal }))
      .rejects.toBe(failure)
    expect(bridge.aborted).toHaveLength(0)
  })

  it('forwards a caller signal and resolves when it never aborts', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const doFetch = (client as unknown as {
      doFetch(input: URL, init?: RequestInit): Promise<Response>
    }).doFetch.bind(client)
    const response = await doFetch(new URL('http://dsh.internal/api/events.mux'), { signal: new AbortController().signal })
    expect(response.ok).toBe(true)
    expect(bridge.aborted).toHaveLength(0)
  })

  it('uses the signal reason for the abort error, falling back to the generic message', () => {
    const byError = new AbortController()
    const custom = new Error('custom')
    byError.abort(custom)
    const byString = new AbortController()
    byString.abort('my reason')
    const byObject = new AbortController()
    byObject.abort({})
    expect(abortError(byError.signal)).toBe(custom)
    expect(abortError(byString.signal)).toMatchObject({ message: 'my reason' })
    expect(abortError(byObject.signal)).toMatchObject({ message: 'This operation was aborted' })
  })

  it('parses mux and host frames from their channels and taps the envelope buffer', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const envelopes: RpcMessage[][] = []
    client.subscribeEnvelopes((batch) => { envelopes.push([...batch]) })
    const opened: string[] = []
    const muxAbort = new AbortController()
    const hostAbort = new AbortController()
    const mux = client.events.mux({}, muxAbort.signal, () => { opened.push('mux') })[Symbol.asyncIterator]()
    const host = client.events.host({}, hostAbort.signal, () => { opened.push('host') })[Symbol.asyncIterator]()
    const muxFrame = mux.next()
    const hostFrame = host.next()
    await vi.waitFor(() => { expect(bridge.subscribed).toEqual(['mux', 'host']) })
    await vi.waitFor(() => { expect(opened).toEqual(['mux', 'host']) })

    bridge.push('mux', {
      type: 'server-request',
      rpcId: 'mux-ipc',
      method: 'session/subscribed',
      payload: { type: 'session/subscribed', sessionId: 'session-ipc', lastSeq: 8 },
    })
    bridge.push('host', {
      type: 'server-request',
      rpcId: 'host-ipc',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })
    expect(await muxFrame).toMatchObject({
      value: { rpcId: 'mux-ipc', payload: { type: 'session/subscribed', lastSeq: 8 } },
    })
    expect(await hostFrame).toMatchObject({
      value: { rpcId: 'host-ipc', payload: { type: 'host/remote-event', event: 'commands/change' } },
    })
    await vi.waitFor(() => { expect(envelopes.flat()).toHaveLength(2) })

    const muxEnd = mux.next()
    const hostEnd = host.next()
    muxAbort.abort()
    hostAbort.abort()
    await expect(muxEnd).resolves.toMatchObject({ done: true })
    await expect(hostEnd).resolves.toMatchObject({ done: true })
    expect(bridge.unsubscribed).toEqual(['mux', 'host'])
  })

  it('closes a stream immediately when its signal was already aborted', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const abort = new AbortController()
    abort.abort()
    const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(bridge.subscribed).toEqual(['mux'])
    expect(bridge.unsubscribed).toEqual(['mux'])
  })

  it('drops malformed frames without killing the stream and honors stream-end', async () => {
    const bridge = new FakeBridge()
    const client = new ElectronApiClient(bridge)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const abort = new AbortController()
    const iterator = client.events.host({}, abort.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await vi.waitFor(() => { expect(bridge.subscribed).toEqual(['host']) })

    bridge.push('host', { type: 'server-request', rpcId: 'bad', method: 'host/x', payload: {} })
    bridge.push('host', {
      type: 'server-request',
      rpcId: 'ok',
      method: 'host/remote-event',
      payload: { type: 'host/remote-event', event: 'commands/change', args: [] },
    })
    expect(await pending).toMatchObject({
      value: { rpcId: 'ok', payload: { type: 'host/remote-event' } },
    })
    expect(errors).toHaveBeenCalledTimes(1)

    bridge.push('host', { type: 'stream-end' })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(bridge.unsubscribed).toEqual(['host'])
    errors.mockRestore()
  })
})
