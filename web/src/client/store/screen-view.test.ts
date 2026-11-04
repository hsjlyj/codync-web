/**
 * ScreenSession 行为测试：假 PeerConnection + MockTransport 全流程。
 * 重点断言信令顺序（订阅先于 offer，signaling.rs:134）、本地候选缓冲与清理。
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/mock-transport'
import { HostError, type HostTransport } from '../transport/host-transport'
import { ScreenSession, type ScreenStage } from './screen-view'

/** 最小假 PC：记录调用与候选，手动驱动连接状态。 */
class FakePc {
  static latest: FakePc | null = null
  iceServers: unknown[]
  remoteDescription: { sdp: string } | null = null
  iceGatheringState = 'new'
  connectionState = 'new'
  closed = false
  addTransceiverCalls: Array<{ kind: string; init: unknown }> = []
  remoteCandidates: Array<{ candidate: string }> = []
  localSent: unknown[] = []
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null
  onicecandidate:
    | ((event: {
        candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null } | null
      }) => void)
    | null = null
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(config: { iceServers: unknown[] }) {
    this.iceServers = config.iceServers
    FakePc.latest = this
  }

  addTransceiver(kind: 'video', init: { direction: 'recvonly' }) {
    this.addTransceiverCalls.push({ kind, init })
  }

  async createOffer() {
    return { sdp: 'v=0（演示 offer SDP）' }
  }

  async setLocalDescription() {
    this.iceGatheringState = 'complete' // 假 PC 立即 gather 完
  }

  async setRemoteDescription(description: { sdp: string; type: 'answer' }) {
    this.remoteDescription = description
  }

  async addIceCandidate(candidate: { candidate: string }) {
    this.remoteCandidates.push(candidate)
  }

  close() {
    this.closed = true
    this.connectionState = 'closed'
  }

  emitLocalCandidate(candidate: string | null) {
    this.onicecandidate?.({
      candidate: candidate === null ? null : { candidate, sdpMLineIndex: 0, sdpMid: '0' },
    })
  }

  emitTrack(stream: MediaStream) {
    this.ontrack?.({ streams: [stream] })
  }

  emitConnectionState(state: string) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

/** 记录 call/stream 顺序的 MockTransport 包装（测试断言信令次序用）。 */
const traceOf = () => {
  const transport = new MockTransport()
  const trace: string[] = []
  const traced = new Proxy(transport, {
    get(target, prop, receiver) {
      if (prop === 'call')
        return (method: string, body?: unknown) => {
          trace.push(`call:${method}`)
          return target.call(method, body)
        }
      if (prop === 'stream')
        return (path: string, onData: (e: unknown) => void, onEnd: (e: HostError | null) => void) => {
          trace.push(`stream:${path.split('?')[0]}`)
          return target.stream(path, onData, onEnd)
        }
      return Reflect.get(target, prop, receiver)
    },
  })
  return { traced, trace }
}

const until = async (predicate: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
  expect(predicate(), '等待条件超时').toBe(true)
}

const stages = () => {
  const seen: ScreenStage[] = []
  return {
    seen,
    handlers: {
      onStage: (stage: ScreenStage) => seen.push(stage),
      onStream: () => {},
    },
  }
}

describe('ScreenSession', () => {
  it('信令顺序：prepare → screenCandidates 订阅 → offer（裸 SDP 字符串）', async () => {
    const { traced, trace } = traceOf()
    const { handlers } = stages()
    const session = new ScreenSession(traced, handlers, (config) => new FakePc(config))
    await session.start()
    expect(trace[0]).toBe('call:screenPrepare')
    expect(trace[1]).toBe('stream:/screen-candidates')
    expect(trace[2]).toBe('call:screenOffer')
    const pc = FakePc.latest!
    expect(pc.addTransceiverCalls).toEqual([{ kind: 'video', init: { direction: 'recvonly' } }])
    expect(pc.remoteDescription?.sdp).toContain('演示应答')
    session.stop()
  })

  it('下行候选经订阅事件进入 addIceCandidate（mock 推两候选 + complete）', async () => {
    const { traced } = traceOf()
    const { handlers } = stages()
    const session = new ScreenSession(traced, handlers, (config) => new FakePc(config))
    await session.start()
    await until(() => (FakePc.latest!.remoteCandidates.length ?? 0) >= 2)
    expect(FakePc.latest!.remoteCandidates[0]!.candidate).toContain('candidate:')
    session.stop()
  })

  it('本地候选在应答后上送（tagged enum 形状），gather 完成发 complete', async () => {
    const transport = new MockTransport()
    const candidates: Array<{ method: string; body: unknown }> = []
    const spy = new Proxy(transport, {
      get(target, prop, receiver) {
        if (prop === 'call')
          return (method: string, body?: unknown) => {
            if (method === 'screenCandidate') candidates.push({ method, body })
            return target.call(method, body)
          }
        return Reflect.get(target, prop, receiver)
      },
    })
    const { handlers } = stages()
    const session = new ScreenSession(spy, handlers, (config) => new FakePc(config))
    await session.start()
    const pc = FakePc.latest!
    pc.emitLocalCandidate('candidate:1 1 udp 1 10.0.0.9 40001 typ host')
    pc.emitLocalCandidate(null) // gather 完成
    await until(() => candidates.at(-1)?.body != null && JSON.stringify(candidates.at(-1)!.body).includes('complete'))
    expect(candidates[0]!.body).toMatchObject({
      candidate: { type: 'candidate', candidate: 'candidate:1 1 udp 1 10.0.0.9 40001 typ host', sdpMLineIndex: 0 },
    })
    expect(candidates.at(-1)!.body).toMatchObject({ candidate: { type: 'complete' } })
    session.stop()
  })

  it('视频轨到达 → onStream；connectionState=connected → connected', async () => {
    const { traced } = traceOf()
    let gotStream: MediaStream | null = null
    const seen: ScreenStage[] = []
    const session = new ScreenSession(
      traced,
      { onStage: (s) => seen.push(s), onStream: (s) => (gotStream = s) },
      (config) => new FakePc(config),
    )
    await session.start()
    const marker = { id: 'demo' } as unknown as MediaStream
    FakePc.latest!.emitTrack(marker)
    FakePc.latest!.emitConnectionState('connected')
    expect(gotStream).toBe(marker)
    expect(seen).toContain('connected')
    session.stop()
  })

  it('stop() 清理：pc.close + screenClose + 退订，幂等', async () => {
    const transport = new MockTransport()
    const closes: number[] = []
    const spy = new Proxy(transport, {
      get(target, prop, receiver) {
        if (prop === 'call')
          return (method: string, body?: unknown) => {
            if (method === 'screenClose') closes.push(1)
            return target.call(method, body)
          }
        return Reflect.get(target, prop, receiver)
      },
    })
    const seen: ScreenStage[] = []
    const session = new ScreenSession(
      spy,
      { onStage: (s) => seen.push(s), onStream: () => {} },
      (config) => new FakePc(config),
    )
    await session.start()
    session.stop()
    session.stop()
    expect(FakePc.latest!.closed).toBe(true)
    expect(closes).toHaveLength(1)
    expect(seen.at(-1)).toBe('closed')
  })

  it('trickle:false：不开订阅，gather 完整后直接 offer', async () => {
    const trace: string[] = []
    const transport: HostTransport = {
      call: async <T>(method: string) => {
        trace.push(`call:${method}`)
        if (method === 'screenPrepare') return { session: 's-fixed', iceServers: [], expiresAt: 0, trickle: false } as T
        if (method === 'screenOffer') return { session: 's-fixed', sdp: 'v=0（完整应答）' } as T
        return {} as T
      },
      stream: () => {
        trace.push('stream:（不应发生）')
        return () => {}
      },
    }
    const { handlers } = stages()
    const session = new ScreenSession(transport, handlers, (config) => new FakePc(config))
    await session.start()
    expect(trace).toEqual(['call:screenPrepare', 'call:screenOffer'])
    session.stop()
  })

  it('403（无 Screen scope）→ failed 带权限说明', async () => {
    const transport: HostTransport = {
      call: <T>() => Promise.reject(new HostError(403, 'no screen scope')) as Promise<T>,
      stream: () => () => {},
    }
    const seen: Array<{ stage: ScreenStage; detail?: string }> = []
    const session = new ScreenSession(
      transport,
      { onStage: (stage, detail) => seen.push({ stage, detail }), onStream: () => {} },
      (config) => new FakePc(config),
    )
    await session.start()
    expect(seen.at(-1)?.stage).toBe('failed')
    expect(seen.at(-1)?.detail).toContain('Screen scope')
  })
})
