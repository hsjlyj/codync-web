/**
 * ChannelTransport —— Web 客户端的主机传输实现（ADR-001：直连 `GET /channel`）。
 * 流程（host/src/remote/channel.rs）：hello → welcome（验证主机签名）→ 加密帧内 RPC。
 * - 请求封套 `{"id","m","b"}` → `{"id","ok"}` / `{"id","err":{status,message}}`（channel.rs:454-510）
 * - 订阅 `{"id","sub","b"}`，事件以 `{"id","ev":<HostEvent>}` 下发，结束 `{"id","end":true}`（subscriptions.rs:96-109）
 * - 明文 reject `{"t":"reject","code"}` 后按 close code 分流（devices.rs:124-138）
 * - 帧计数器到 2^32 → 主机关 4011，必须重连换钥（channel.rs MAX_AGE/REKEY）
 * - 配对模式（pair 选项）：hello 带 pair:true → welcome 后发一次 `pair` → 成功回复后主机
 *   以 4100 paired 收线（pairing.rs:69-70），调用方换普通连接重拨。
 * 设备签名密钥：signer（WebCrypto non-extractable / 包裹回退，见 device-key.ts）或测试用种子。
 */
import type {
  ChannelHello,
  ChannelReject,
  ChannelWelcome,
  DeviceCertificate,
  PairReply,
  RejectCode,
} from '@codync/shared'
import { CHANNEL_CLOSE_CODES, REJECT_CLOSE_CODES } from '@codync/shared'
import {
  ChannelCryptoError,
  Opener,
  Sealer,
  b64urlDecode,
  b64urlEncode,
  cidRawOf,
  channelKeys,
  ed25519Public,
  ed25519Sign,
  ed25519Verify,
  hs1Input,
  randomBytes,
  randomX25519Private,
  transcriptHash,
  x25519Public,
  x25519Shared,
  utf8,
  type FrameJson,
} from './channel-crypto'
import type { DeviceSigner } from './device-key'
import { HostError, type ClosePolicy, type HostTransport, type TransportStatus } from './host-transport'

/** 主机回包：应答、事件推送或订阅结束（同一加密封套，按字段区分）。 */
interface InnerMessage {
  id: number
  ok?: unknown
  err?: { status: number; message: string }
  ev?: unknown
  end?: boolean
}

export interface ChannelOptions {
  /** 主机 `/channel` 的 ws(s) 地址，如 `ws://192.168.1.10:19222/channel`。 */
  url: string
  /** 主机 computerId（16 字节的 base64url）。 */
  computerId: string
  /** 设备 Ed25519 私钥种子（32B）；与 `signer` 二选一（测试/内存场景用种子）。 */
  deviceSignSeed?: Uint8Array
  /** 设备签名者（WebCrypto non-extractable 或包裹回退，见 device-key.ts）。 */
  signer?: DeviceSigner
  /** 主机 Ed25519 公钥（base64url）；提供则强校验 `welcome` 签名（防中间人，砚边审计要求）。 */
  hostSignKey?: string
  /** events 订阅的 client 标识。 */
  clientName?: string
  /** 配对模式：hello 带 `pair:true`，welcome 后发一次 `pair` 请求（pairing.rs:24）。 */
  pair?: {
    code: string
    /** 设备名（主机审批提示里显示，≤100 字符）。 */
    name: string
    /** 主机白名单：ios | macos | android（pairing.rs:35；web 待主机加入白名单）。 */
    platform: string
    /** 云签发的设备证书；缺省时主机按协议以 4400 拒绝（certificate.rs:69）。 */
    certificate?: DeviceCertificate
  }
  onStatus?: (status: TransportStatus, detail?: string) => void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15_000
const LIMITED_RETRIES = 3
const HANDSHAKE_TIMEOUT_MS = 10_000

/** close code → 重连决策（试金 QA 口径，源：channel.rs close 模块 + devices.rs RejectCode）。 */
export function closePolicyOf(code: number): ClosePolicy {
  if (code === CHANNEL_CLOSE_CODES.rekey || code === CHANNEL_CLOSE_CODES.timeout) return { action: 'reconnect' }
  // 4100 paired：配对成功后主机主动收线，应作为已授权设备重新拨号（砚台 api-types PairReply 注释）。
  if (code === CHANNEL_CLOSE_CODES.paired) return { action: 'stop', reason: '配对成功，正在以已授权设备重新连接…' }
  if (code === CHANNEL_CLOSE_CODES.protocolError || code === CHANNEL_CLOSE_CODES.unauthorized)
    return { action: 'retry-limited', reason: '握手失败或签名被拒，正在重试…' }
  if (code === REJECT_CLOSE_CODES.rateLimited) return { action: 'reconnect-slow' }
  if (code === REJECT_CLOSE_CODES.revoked) return { action: 'stop', reason: '设备已被移除，请重新配对。' }
  if (code === REJECT_CLOSE_CODES.unsupportedVersion)
    return { action: 'stop', reason: '主机版本过旧，请升级主机端的 Codync。' }
  if (code === REJECT_CLOSE_CODES.pairingClosed || code === CHANNEL_CLOSE_CODES.pairingExpired)
    return { action: 'stop', reason: '配对码已过期或已关闭，请刷新配对码。' }
  return { action: 'reconnect' }
}

interface StreamEntry {
  sub: string
  b?: unknown
  onData: (event: unknown) => void
  onEnd: (error: HostError | null) => void
}

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: HostError) => void
  timer: ReturnType<typeof setTimeout>
}

export class ChannelTransport implements HostTransport {
  private ws: WebSocket | null = null
  private status: TransportStatus = 'idle'
  private statusDetail: string | undefined
  private sealer: Sealer | null = null
  private opener: Opener | null = null
  private pending = new Map<number, PendingCall>()
  private streams = new Map<number, StreamEntry>()
  private nextId = 1
  private retries = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private ekPrivate: Uint8Array | null = null
  private closedByUser = false
  private whenOpenResolve: (() => void) | null = null
  private whenOpenReject: ((e: HostError) => void) | null = null
  private whenOpen: Promise<void> | null = null

  constructor(private readonly options: ChannelOptions) {}

  private setStatus(status: TransportStatus, detail?: string) {
    this.status = status
    this.statusDetail = detail
    this.options.onStatus?.(status, detail)
  }

  get currentStatus(): TransportStatus {
    return this.status
  }

  /** 连接就绪（welcome 验证通过、加密帧可用）的 Promise。 */
  whenReady(): Promise<void> {
    if (this.status === 'open') return Promise.resolve()
    if (!this.whenOpen)
      this.whenOpen = new Promise((resolve, reject) => {
        this.whenOpenResolve = resolve
        this.whenOpenReject = reject
      })
    return this.whenOpen
  }

  connect() {
    if (this.ws) return
    this.closedByUser = false
    this.setStatus(this.retries > 0 ? 'reconnecting' : 'connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.options.url)
    } catch {
      this.setStatus('failed', `地址无效：${this.options.url}`)
      this.failWhenOpen(HostError.unreachable())
      return
    }
    this.ws = ws
    ws.onopen = () => void this.sendHello()
    ws.onmessage = (event) => this.onMessage(String(event.data))
    ws.onclose = (event) => this.onClose(event.code)
    ws.onerror = () => {
      /* close 事件随后必到，统一在 onClose 分流 */
    }
  }

  /** 主动断开：不再重连。 */
  disconnect() {
    this.closedByUser = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000, '')
    this.teardown()
    this.setStatus('closed')
  }

  async call<T = unknown>(method: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    await this.whenReady()
    const ws = this.ws
    if (!ws || !this.sealer) throw HostError.unreachable()
    const id = this.nextId
    this.nextId += 1
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HostError(0, `主机响应超时（${method}，${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    })
    this.sendInner({ id, m: method, b: body ?? {} })
    return promise
  }

  stream(path: string, onData: (event: unknown) => void, onEnd: (error: HostError | null) => void): () => void {
    if (this.status !== 'open') {
      onEnd(HostError.unreachable())
      return () => {}
    }
    const { sub, b } = parseStreamPath(path, this.options.clientName)
    const id = this.nextId
    this.nextId += 1
    this.streams.set(id, { sub, b, onData, onEnd })
    this.sendInner({ id, sub, b })
    return () => {
      if (!this.streams.delete(id)) return
      this.sendInner({ id, cancel: true })
    }
  }

  // MARK: 握手

  private async sendHello() {
    const cidRaw = cidRawOf(this.options.computerId)
    const ekPrivate = randomX25519Private()
    const ekD = x25519Public(ekPrivate)
    const n = randomBytes(32)
    const dk = this.devicePublicKey()
    if (!dk) {
      this.onClose(0, '缺少设备签名密钥（deviceSignSeed 或 signer 二选一）')
      return
    }
    const sigInput = hs1Input(cidRaw, dk, ekD, n)
    const sig = this.options.signer
      ? await this.options.signer.sign(sigInput)
      : ed25519Sign(sigInput, this.options.deviceSignSeed!)
    this.ekPrivate = ekPrivate
    this.helloDk = dk
    const hello: ChannelHello = {
      t: 'hello',
      v: 1,
      dk: b64urlEncode(dk),
      ek: b64urlEncode(ekD),
      n: b64urlEncode(n),
      sig: b64urlEncode(sig),
    }
    if (this.options.pair) hello.pair = true
    // 握手状态供 acceptWelcome 复原 transcript（缺失会在收到 welcome 时以
    // protocolError「握手状态丢失」收线——新刃审查抓出的 [BLOCK]）。
    this.lastHello = { ek: hello.ek, n: hello.n }
    this.handshakeTimer = setTimeout(() => this.onClose(0, '握手超时'), HANDSHAKE_TIMEOUT_MS)
    this.ws?.send(JSON.stringify(hello))
    this.setStatus('handshaking')
  }

  private helloDk: Uint8Array | null = null

  /** 设备公钥：signer 自带，或从种子推导。 */
  private devicePublicKey(): Uint8Array | null {
    if (this.options.signer) return b64urlDecode(this.options.signer.signPubB64)
    return this.options.deviceSignSeed ? ed25519Public(this.options.deviceSignSeed) : null
  }

  private acceptWelcome(text: string) {
    let welcome: ChannelWelcome
    try {
      welcome = JSON.parse(text) as ChannelWelcome
    } catch {
      return this.onClose(CHANNEL_CLOSE_CODES.protocolError, 'welcome 不是 JSON')
    }
    if (welcome.t !== 'welcome' || welcome.v !== 1)
      return this.onClose(CHANNEL_CLOSE_CODES.protocolError, 'welcome 版本不符')
    const cidRaw = cidRawOf(this.options.computerId)
    const dk = this.helloDk
    const hello = this.lastHello
    if (!dk || !hello || !this.ekPrivate) return this.onClose(CHANNEL_CLOSE_CODES.protocolError, '握手状态丢失')
    const ekH = b64urlDecode(welcome.ek)
    const th = transcriptHash(cidRaw, dk, b64urlDecode(hello.ek), b64urlDecode(hello.n), ekH)
    if (this.options.hostSignKey) {
      const ok = ed25519Verify(b64urlDecode(welcome.sig), th, b64urlDecode(this.options.hostSignKey))
      if (!ok) return this.onClose(CHANNEL_CLOSE_CODES.unauthorized, '主机签名验证失败（可能存在中间人）')
    }
    const shared = x25519Shared(this.ekPrivate, ekH)
    const keys = channelKeys(shared, th)
    this.sealer = new Sealer(keys.d2h)
    this.opener = new Opener(keys.h2d)
    this.ekPrivate = null
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
    this.retries = 0
    this.setStatus('open')
    this.whenOpenResolve?.()
    this.whenOpen = null
    // 重连后重新订阅所有活跃流（sync 契约：按 rev 追平）。
    for (const [id, entry] of this.streams) this.sendInner({ id, sub: entry.sub, b: entry.b })
    // 配对通道：welcome 后立即发唯一一次 pair 请求（pairing.rs read_pair 等第一条内层消息）。
    if (this.options.pair) void this.sendPairRequest()
  }

  private lastHello: { ek: string; n: string } | null = null

  // MARK: 配对（pairing.rs:24 pair：一次请求，成功后主机以 4100 paired 收线）

  /** 配对结果：resolve 于主机 ok（含 computerId），reject 于拒绝/超时/收线。 */
  pairOutcome(): Promise<PairReply> {
    if (!this.options.pair) return Promise.reject(new HostError(0, '该传输未启用配对模式'))
    if (!this.pairPromise) {
      this.pairPromise = new Promise<PairReply>((resolve, reject) => {
        this.pairResolve = resolve
        this.pairReject = reject
      })
    }
    return this.pairPromise
  }

  private pairPromise: Promise<PairReply> | null = null
  private pairResolve: ((reply: PairReply) => void) | null = null
  private pairReject: ((error: HostError) => void) | null = null
  private pairFinished = false

  private async sendPairRequest() {
    const pair = this.options.pair
    if (!pair) return
    try {
      const reply = await this.call<PairReply>(
        'pair',
        {
          code: pair.code,
          name: pair.name,
          platform: pair.platform,
          ...(pair.certificate ? { certificate: pair.certificate } : {}),
        },
        120_000,
      )
      this.pairFinished = true
      this.pairResolve?.(reply)
    } catch (e) {
      this.pairFinished = true
      const error = e instanceof HostError ? e : new HostError(0, e instanceof Error ? e.message : String(e))
      this.pairReject?.(error)
      this.setStatus('failed', error.message)
    }
  }

  // MARK: 消息分发

  private onMessage(text: string) {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return this.onClose(CHANNEL_CLOSE_CODES.protocolError, '消息不是 JSON')
    }
    const v = value as Record<string, unknown>
    if (v.t === 'reject') {
      const reject = v as unknown as ChannelReject
      const close = REJECT_CLOSE_CODES[reject.code as RejectCode] ?? CHANNEL_CLOSE_CODES.protocolError
      return this.onClose(close, reject.message)
    }
    if (v.t === 'welcome') {
      return this.acceptWelcome(text)
    }
    if (!this.opener) return this.onClose(CHANNEL_CLOSE_CODES.protocolError, '未握手就收到帧')
    try {
      const message = this.opener.open(value)
      if (message) this.onInner(JSON.parse(utf8Of(message)) as InnerMessage)
    } catch (e) {
      if (e instanceof ChannelCryptoError) {
        const code =
          e.kind === 'rekey'
            ? CHANNEL_CLOSE_CODES.rekey
            : e.kind === 'tooLarge'
              ? CHANNEL_CLOSE_CODES.tooLarge
              : CHANNEL_CLOSE_CODES.protocolError
        return this.onClose(code, e.message)
      }
      return this.onClose(CHANNEL_CLOSE_CODES.protocolError, '内层消息不是 JSON')
    }
  }

  private onInner(message: InnerMessage) {
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (pending) {
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.err) pending.reject(new HostError(message.err.status ?? 500, message.err.message ?? '主机返回错误'))
      else pending.resolve(message.ok)
      return
    }
    const stream = this.streams.get(message.id)
    if (!stream) return
    if (message.ev !== undefined) stream.onData(message.ev)
    else if (message.end) {
      this.streams.delete(message.id)
      stream.onEnd(null)
    }
  }

  // MARK: 连接维护

  private sendInner(inner: Record<string, unknown>) {
    const ws = this.ws
    if (!ws || !this.sealer || ws.readyState !== WebSocket.OPEN) return
    const frames: FrameJson[] | null = this.sealer.seal(utf8(JSON.stringify(inner)))
    if (!frames) return this.onClose(CHANNEL_CLOSE_CODES.rekey, '帧计数器用尽')
    for (const frame of frames) ws.send(JSON.stringify(frame))
  }

  private onClose(code: number, detail?: string) {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
    this.ws = null
    this.sealer = null
    this.opener = null
    this.lastHello = null
    this.helloDk = null
    this.ekPrivate = null
    // 挂起调用必须落定（否则 await 永久悬挂）：以本次 close 的原因拒绝。
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new HostError(code, detail ?? '连接已关闭'))
    }
    this.pending.clear()
    if (this.closedByUser) {
      this.setStatus('closed')
      return
    }
    // 配对通道：一次尝试结束（成功 4100 或被拒）后不再自动重连，由调用方决定下一步
    // （成功 → 换普通连接重拨；失败 → 展示原因）。配对码一次性，重连必然 4410。
    if (this.options.pair && (this.pairFinished || code === CHANNEL_CLOSE_CODES.paired)) {
      if (code !== CHANNEL_CLOSE_CODES.paired && !this.pairFinished) {
        this.failWhenOpen(new HostError(code, detail ?? '配对流程在确认前结束'))
        this.setStatus('failed', detail ?? '配对流程在确认前结束')
      }
      return
    }
    const policy = code === 0 ? ({ action: 'reconnect' } as const) : closePolicyOf(code)
    if (policy.action === 'stop') {
      this.failWhenOpen(new HostError(code, policy.reason))
      this.setStatus('failed', policy.reason)
      return
    }
    if (policy.action === 'retry-limited') {
      this.retries += 1
      if (this.retries > LIMITED_RETRIES) {
        this.failWhenOpen(new HostError(code, policy.reason))
        this.setStatus('failed', '多次握手失败，已停止重连。')
        return
      }
    }
    this.failWhenOpen(HostError.unreachable())
    // 释放 whenOpen，让等待方下次拿到新的 Promise（重连成功后恢复）。
    this.whenOpen = null
    const delay = backoffMs(this.retries, policy.action === 'reconnect-slow')
    this.setStatus('reconnecting', detail ? `${detail}，${Math.round(delay / 1000)}s 后重连` : undefined)
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private failWhenOpen(error: HostError) {
    if (this.whenOpen) {
      this.whenOpenReject?.(error)
      this.whenOpen = null
    }
  }

  private teardown() {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new HostError(0, '传输已断开'))
    }
    this.pending.clear()
    this.streams.clear()
    this.sealer = null
    this.opener = null
    this.lastHello = null
    if (!this.pairFinished) this.pairReject?.(new HostError(0, '传输已断开'))
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.reconnectTimer = null
    this.handshakeTimer = null
  }
}

const backoffMs = (retries: number, slow: boolean) => {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** retries, RECONNECT_MAX_MS)
  const jitter = Math.random() * 500
  return slow ? base * 2 + jitter : base + jitter
}

/** `/events?since=5&client=web` → events 订阅；`/term/abc` → term 订阅；`/screen-candidates?session=` → ICE 订阅。 */
export function parseStreamPath(path: string, clientName?: string): { sub: string; b?: unknown } {
  const url = new URL(path, 'https://channel.invalid')
  if (url.pathname === '/events')
    return {
      sub: 'events',
      b: {
        since: Number(url.searchParams.get('since') ?? 0),
        client: url.searchParams.get('client') ?? clientName ?? 'web',
      },
    }
  if (url.pathname.startsWith('/term/')) return { sub: 'term', b: { term: url.pathname.slice('/term/'.length) } }
  if (url.pathname === '/screen-candidates')
    return { sub: 'screenCandidates', b: { session: url.searchParams.get('session') ?? '' } }
  throw new Error(`未支持的流路径：${path}`)
}

const utf8Of = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
