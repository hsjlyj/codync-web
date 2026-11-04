/**
 * 屏幕查看会话编排（Phase 3 骨架）：viewer 只收流不发输入。
 * 信令顺序是硬约束（signaling.rs:134）：`screenPrepare` → **先开 `screenCandidates`
 * 订阅** → createOffer/setLocalDescription → `screenOffer`（裸 SDP 字符串）→ answer
 * setRemoteDescription → 之后本地 candidate 才被主机接受（Answered 检查，
 * signaling.rs:220），故先缓冲、应答后冲刷。下行 candidate 走订阅事件
 * `{type:"candidate"|"complete"|"error"}`。`trickle:false` 时不开订阅（主机会拒绝
 * "does not support trickle ICE"），等 gather 完整后随完整 SDP 一次性 offer。
 * RTCPeerConnection 以工厂注入：测试用替身，浏览器用真实现；stop() 幂等收清全部资源。
 */
import type { ScreenPrepareResult } from '@codync/shared'
import { HostError, type HostTransport } from '../transport/host-transport'

/** 浏览器 RTCPeerConnection 的最小结构面（测试替身只需实现这些成员）。 */
export interface ScreenPeerConnection {
  addTransceiver(kind: 'video', init: { direction: 'recvonly' }): void
  createOffer(): Promise<{ sdp: string | null }>
  setLocalDescription(description: { sdp: string | null }): Promise<void>
  setRemoteDescription(description: { sdp: string; type: 'answer' }): Promise<void>
  addIceCandidate(candidate: {
    candidate: string
    sdpMLineIndex?: number | null
    sdpMid?: string | null
  }): Promise<void>
  close(): void
  ontrack: ((event: { streams: MediaStream[] }) => void) | null
  onicecandidate:
    | ((event: {
        candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null } | null
      }) => void)
    | null
  onicegatheringstatechange: (() => void) | null
  onconnectionstatechange: (() => void) | null
  iceGatheringState: string
  connectionState: string
  /** 应答是否已落地（RTCPeerConnection.remoteDescription；null = 主机还没接受候选）。 */
  remoteDescription: { sdp: string } | null
}

export type ScreenPcFactory = (config: { iceServers: unknown[] }) => ScreenPeerConnection

/** 真实现（仅浏览器；页面守卫已连接后才可能被调用）。 */
export const browserPcFactory: ScreenPcFactory = (config) =>
  new RTCPeerConnection(config as RTCConfiguration) as unknown as ScreenPeerConnection

export type ScreenStage = 'idle' | 'preparing' | 'connecting' | 'connected' | 'closed' | 'failed'

export interface ScreenHandlers {
  onStage: (stage: ScreenStage, detail?: string) => void
  /** 主机视频轨到达（MediaStream 交给 video.srcObject）。 */
  onStream: (stream: MediaStream) => void
}

export class ScreenSession {
  private pc: ScreenPeerConnection | null = null
  private stopStream: (() => void) | null = null
  private session = ''
  private stopped = false
  /** 本地 ICE 候选缓冲：应答落地前主机不接受（Answered 检查）。 */
  private pendingLocal: Array<{ candidate: string; sdpMLineIndex?: number | null; sdpMid?: string | null }> = []
  private localComplete = false
  private trickle = true

  constructor(
    private readonly transport: HostTransport,
    private readonly handlers: ScreenHandlers,
    private readonly pcFactory: ScreenPcFactory = browserPcFactory,
  ) {}

  /** 建立查看会话；幂等（进行中/已建立时再次调用是 no-op）。 */
  async start(): Promise<void> {
    if (this.pc || this.stopped) return
    this.handlers.onStage('preparing')
    try {
      const prepared = await this.transport.call<ScreenPrepareResult>('screenPrepare', { trickle: true })
      if (this.stopped) return
      this.session = prepared.session
      this.trickle = prepared.trickle
      this.pc = this.pcFactory({ iceServers: prepared.iceServers })
      this.wirePeer(this.pc)
      // viewer 只收流：声明 recvonly 视频收发器，主机据此应答带 track 的 answer。
      this.pc.addTransceiver('video', { direction: 'recvonly' })

      if (this.trickle) {
        // 顺序硬约束：订阅必须先于 screenOffer（signaling.rs:134）。
        this.stopStream = this.transport.stream(
          `/screen-candidates?session=${encodeURIComponent(this.session)}`,
          (raw) => this.onRemoteCandidate(raw),
          (error) => this.onSignalEnd(error),
        )
      }
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)
      if (this.stopped) return
      if (!this.trickle) await this.gathered(this.pc)

      const answered = await this.transport.call<{ session: string; sdp: string }>('screenOffer', {
        session: this.session,
        sdp: offer.sdp ?? '',
      })
      if (this.stopped) return
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answered.sdp })
      this.handlers.onStage('connecting')
      await this.flushLocalCandidates()
    } catch (e) {
      if (this.stopped) return
      this.fail(describeScreenError(e))
    }
  }

  /** 结束会话：退订 + screenClose + 关闭 PeerConnection。幂等；之后不可复用（重开建新会话）。 */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.stopStream) {
      this.stopStream()
      this.stopStream = null
    }
    const session = this.session
    this.session = ''
    this.pc?.close()
    this.pc = null
    if (session) {
      void this.transport.call('screenClose', { session }).catch(() => {})
    }
    this.handlers.onStage('closed')
  }

  private wirePeer(pc: ScreenPeerConnection) {
    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream && !this.stopped) this.handlers.onStream(stream)
    }
    pc.onicecandidate = (event) => {
      if (this.stopped) return
      if (event.candidate) this.pendingLocal.push(event.candidate)
      else this.localComplete = true
      void this.flushLocalCandidates()
    }
    pc.onicegatheringstatechange = () => {
      /* gathered() 的等待者通过轮询 iceGatheringState 收敛，无需额外处理 */
    }
    pc.onconnectionstatechange = () => {
      if (this.stopped) return
      if (pc.connectionState === 'connected') this.handlers.onStage('connected')
      else if (pc.connectionState === 'failed') this.fail('媒体连接失败：请检查网络后重试')
      else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') this.handlers.onStage('closed')
    }
  }

  /** 冲刷链：串行化上送，保证 complete 不会越过候选（信令按序，signaling.rs Progress 语义）。 */
  private flushChain: Promise<void> = Promise.resolve()

  private flushLocalCandidates(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.flushNow())
    return this.flushChain
  }

  private async flushNow(): Promise<void> {
    if (!this.trickle || !this.pc || this.stopped) return
    if (this.pc.remoteDescription === null) return
    // 本地候选上送主机（screenCandidate）；pc.addIceCandidate 只用于下行（onRemoteCandidate）。
    while (this.pendingLocal.length) {
      const candidate = this.pendingLocal.shift()!
      await this.transport
        .call('screenCandidate', { session: this.session, candidate: { type: 'candidate', ...candidate } })
        .catch(() => {})
    }
    if (this.localComplete) {
      this.localComplete = false
      await this.transport
        .call('screenCandidate', { session: this.session, candidate: { type: 'complete' } })
        .catch(() => {})
    }
  }

  private onRemoteCandidate(raw: unknown): void {
    if (!this.pc || this.stopped) return
    const event = raw as {
      type?: string
      message?: string
      candidate?: string
      sdpMLineIndex?: number
      sdpMid?: string
    }
    if (event.type === 'candidate' && event.candidate) {
      void this.pc
        .addIceCandidate({ candidate: event.candidate, sdpMLineIndex: event.sdpMLineIndex, sdpMid: event.sdpMid })
        .catch(() => {})
    } else if (event.type === 'error') {
      this.fail(event.message ?? '主机信令错误')
    }
    // complete：下行无候选了，无需处理（媒体连通性由 connectionState 收敛）
  }

  private onSignalEnd(error: HostError | null): void {
    if (this.stopped || !this.pc) return
    // 主机仅在信令失败/会话关闭时收束订阅；已建立的媒体连接不受影响。
    if (error && this.pc.connectionState !== 'connected') this.fail(error.message)
  }

  private async gathered(pc: ScreenPeerConnection): Promise<void> {
    const deadline = Date.now() + 3000
    while (pc.iceGatheringState !== 'complete' && Date.now() < deadline && !this.stopped) {
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  private fail(message: string): void {
    if (this.stopped) return
    this.stopped = true
    if (this.stopStream) {
      this.stopStream()
      this.stopStream = null
    }
    const session = this.session
    this.session = ''
    this.pc?.close()
    this.pc = null
    if (session) void this.transport.call('screenClose', { session }).catch(() => {})
    this.handlers.onStage('failed', message)
  }
}

/** 403 = 设备无 Screen scope（devices.rs:90）；其余原样透出。 */
function describeScreenError(e: unknown): string {
  if (e instanceof HostError && e.status === 403)
    return `设备缺少屏幕权限（Screen scope）：请在主机端重新配对或授权。原因：${e.message}`
  return e instanceof Error ? e.message : String(e)
}
