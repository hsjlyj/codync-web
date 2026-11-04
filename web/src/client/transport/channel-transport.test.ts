/**
 * close code → 重连策略断言（试金 QA 基线：channel.rs close 模块 + devices.rs RejectCode）。
 * 纯函数测试 + mock-WebSocket 握手集成测试（新刃审查要求：传输层状态机此前零覆盖，
 * sendHello 漏赋 lastHello 的 [BLOCK] 正是因此漏网）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANNEL_CLOSE_CODES, REJECT_CLOSE_CODES } from '@codync/shared'
import {
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
  randomX25519Private,
  transcriptHash,
  utf8,
  x25519Public,
  x25519Shared,
  type FrameJson,
} from './channel-crypto'
import { ChannelTransport, closePolicyOf } from './channel-transport'

describe('closePolicyOf', () => {
  it('4011 rekey 与 1011 timeout：立即重连（换钥/超时非故障）', () => {
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.rekey)).toEqual({ action: 'reconnect' })
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.timeout)).toEqual({ action: 'reconnect' })
  })

  it('4100 paired：停止重连——配对码一次性，重开普通通道由调用方负责', () => {
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.paired)).toEqual({
      action: 'stop',
      reason: '配对成功，正在以已授权设备重新连接…',
    })
  })

  it('4001 unauthorized：限次重试（带提示）', () => {
    const policy = closePolicyOf(REJECT_CLOSE_CODES.unauthorized)
    expect(policy).toMatchObject({ action: 'retry-limited' })
    if (policy.action === 'retry-limited') expect(policy.reason).toContain('重试')
  })

  it('4008 rateLimited：慢退避重连', () => {
    expect(closePolicyOf(REJECT_CLOSE_CODES.rateLimited)).toEqual({ action: 'reconnect-slow' })
  })

  it('4003 revoked / 4400 unsupportedVersion / 4410 pairingClosed：终止并给出用户话术', () => {
    for (const code of [
      REJECT_CLOSE_CODES.revoked,
      REJECT_CLOSE_CODES.unsupportedVersion,
      REJECT_CLOSE_CODES.pairingClosed,
    ]) {
      const policy = closePolicyOf(code)
      expect(policy.action).toBe('stop')
      if (policy.action === 'stop') expect(policy.reason.length).toBeGreaterThan(0)
    }
    expect(closePolicyOf(REJECT_CLOSE_CODES.revoked)).toHaveProperty('reason', expect.stringContaining('重新配对'))
    expect(closePolicyOf(REJECT_CLOSE_CODES.unsupportedVersion)).toHaveProperty(
      'reason',
      expect.stringContaining('升级主机'),
    )
    expect(closePolicyOf(REJECT_CLOSE_CODES.pairingClosed)).toHaveProperty('reason', expect.stringContaining('配对码'))
  })

  it('未知 close code：默认重连（不断链即放弃）', () => {
    expect(closePolicyOf(3000)).toEqual({ action: 'reconnect' })
    expect(closePolicyOf(4500)).toEqual({ action: 'reconnect' })
  })
})

// ---- mock-WebSocket 握手集成（测试扮演主机：channel.rs 同款推导） ----

/** 记录外发消息的最小假 socket；静态常量供 transport 的 readyState 比较使用。 */
class FakeSocket {
  static instances: FakeSocket[] = []
  static CONNECTING = 0 as const
  static OPEN = 1 as const
  static CLOSING = 2 as const
  static CLOSED = 3 as const
  readyState: number = FakeSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = FakeSocket.CLOSED
  }
}

const HOST_SEED = new Uint8Array(32).fill(7)
const DEVICE_SEED = new Uint8Array(32).fill(9)
const COMPUTER_ID = b64urlEncode(new Uint8Array(16).fill(3))

describe('ChannelTransport 握手（mock-WebSocket 集成）', () => {
  const realWebSocket = globalThis.WebSocket
  let statuses: string[] = []

  beforeEach(() => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    statuses = []
  })
  afterEach(() => {
    globalThis.WebSocket = realWebSocket
    FakeSocket.instances.at(-1)?.onclose?.({ code: 1000 })
  })

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  /** 打开连接并吃进 hello，返回（transport, ws, 主机侧密钥材料）。 */
  const connectAndHello = async (transport: ChannelTransport) => {
    transport.connect()
    const ws = FakeSocket.instances.at(-1)!
    ws.onopen?.()
    await flush() // sendHello 是 async，hello 帧要等一个微任务
    expect(ws.sent).toHaveLength(1)
    const hello = JSON.parse(ws.sent[0]!) as { t: string; v: number; dk: string; ek: string; n: string; sig: string }
    expect(hello.t).toBe('hello')
    expect(hello.v).toBe(1)
    const cidRaw = cidRawOf(COMPUTER_ID)
    const dk = b64urlDecode(hello.dk)
    const ekD = b64urlDecode(hello.ek)
    const n = b64urlDecode(hello.n)
    // hello 签名可被主机用设备公钥验证（hs1_input 逐字节一致）。
    expect(ed25519Verify(b64urlDecode(hello.sig), hs1Input(cidRaw, dk, ekD, n), dk)).toBe(true)
    // 主机侧：临时 X25519 → TH → 签名 welcome（与 channel.rs 握手同构）。
    const ekHPriv = randomX25519Private()
    const ekH = x25519Public(ekHPriv)
    const th = transcriptHash(cidRaw, dk, ekD, n, ekH)
    const shared = x25519Shared(ekHPriv, ekD)
    const keys = channelKeys(shared, th)
    return {
      transport,
      ws,
      cidRaw,
      dk,
      ekD,
      n,
      keys,
      welcome: { t: 'welcome', v: 1, ek: b64urlEncode(ekH), sig: b64urlEncode(ed25519Sign(th, HOST_SEED)) },
    }
  }

  it('hello→welcome→加密 RPC 全链路：状态转 open，帧双向可解', async () => {
    const transport = new ChannelTransport({
      url: 'ws://host:19222/channel',
      computerId: COMPUTER_ID,
      deviceSignSeed: DEVICE_SEED,
      hostSignKey: b64urlEncode(ed25519Public(HOST_SEED)),
      onStatus: (status) => statuses.push(status),
    })
    const { ws, keys, welcome } = await connectAndHello(transport)

    ws.onmessage?.({ data: JSON.stringify(welcome) })
    await transport.whenReady()
    expect(transport.currentStatus).toBe('open')
    expect(statuses).toContain('open')

    // 主机解一帧客户端 RPC（d2h 方向），载荷是封套 {id, m, b}。
    const pending = transport.call<{ name: string }>('hello')
    await flush() // call 先 await whenReady（微任务）后才真正发出帧
    const hostOpener = new Opener(keys.d2h)
    const frames = ws.sent.slice(1).map((line) => JSON.parse(line) as FrameJson)
    const opened = hostOpener.open(frames[0]!)
    if (!opened) throw new Error('主机侧未解出完整帧')
    const inner = JSON.parse(new TextDecoder().decode(opened)) as { id: number; m: string; b: unknown }
    expect(inner).toMatchObject({ id: 1, m: 'hello', b: {} })

    // 主机用 h2d 方向回帧，客户端 pending call 落定。
    const sealed = new Sealer(keys.h2d).seal(utf8(JSON.stringify({ id: 1, ok: { name: '演示主机' } })))
    const reply = sealed?.[0]
    if (!reply) throw new Error('封帧失败')
    ws.onmessage?.({ data: JSON.stringify(reply) })
    await expect(pending).resolves.toEqual({ name: '演示主机' })
    transport.disconnect()
  })

  it('welcome 签名不符：拒绝握手、按限次重试分流（防中间人生效）', async () => {
    const transport = new ChannelTransport({
      url: 'ws://host:19222/channel',
      computerId: COMPUTER_ID,
      deviceSignSeed: DEVICE_SEED,
      hostSignKey: b64urlEncode(ed25519Public(HOST_SEED)),
      onStatus: (status, detail) => {
        statuses.push(status)
        if (detail) statuses.push(detail)
      },
    })
    const { ws, welcome } = await connectAndHello(transport)

    // 攻击者换掉自己的 X25519 公钥但签不出正确 TH。
    const bogus = { ...welcome, ek: b64urlEncode(x25519Public(randomX25519Private())) }
    ws.onmessage?.({ data: JSON.stringify(bogus) })
    await flush()
    expect(transport.currentStatus).toBe('reconnecting')
    expect(statuses.some((s) => s.includes('主机签名验证失败'))).toBe(true)
    transport.disconnect()
    expect(transport.currentStatus).toBe('closed')
  })
})
