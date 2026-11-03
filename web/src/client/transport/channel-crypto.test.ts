/**
 * 加密原语回归 —— 基线为 Codync 官方测试向量（docs/reference/fixtures/remote-relay-vectors.json，
 * spec rev 2），本文件内的副本与其同源，主机协议变更时需同步更新。
 * 覆盖：hs1 签名输入与签名、X25519 共享密钥、transcript hash、HKDF 方向密钥、
 * 帧 seal/open（含 FLAG_MORE 分帧）、Sealer→Opener 往返、乱序计数器拒绝（重放检测）。
 */
import { describe, expect, it } from 'vitest'
import {
  ChannelCryptoError,
  Opener,
  Sealer,
  b64urlDecode,
  channelKeys,
  ed25519Public,
  ed25519Sign,
  ed25519Verify,
  hs1Input,
  openFrame,
  sealFrame,
  transcriptHash,
  x25519Shared,
} from './channel-crypto'
import vectors from './channel-crypto.vectors.json'

interface FrameVector {
  dir: 'd2h' | 'h2d'
  c: number
  final: boolean
  message: string
  plaintext: string
  d: string
}

const frameKey = (f: FrameVector): Uint8Array =>
  b64urlDecode(f.dir === 'd2h' ? vectors.handshake.kD2H : vectors.handshake.kH2D)
const bytes = (b64url: string): Uint8Array => b64urlDecode(b64url)
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const hex = (bytes_: Uint8Array): string => [...bytes_].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('channel-crypto 对官方向量（remote-relay-vectors.json）', () => {
  const k = vectors.keys
  const h = vectors.handshake

  it('hs1Input 字节布局与向量一致（codync/hs1/v1 ‖ cid ‖ dk ‖ ekD ‖ n）', () => {
    const input = hs1Input(bytes(k.computerId), bytes(k.deviceSignPub), bytes(h.deviceEphPub), bytes(h.n))
    expect(hex(input)).toBe(hex(bytes(h.hs1SignInput)))
  })

  it('Ed25519 签名与向量一致，可用设备公钥验证、被其他公钥拒绝', () => {
    const sig = ed25519Sign(bytes(h.hs1SignInput), bytes(k.deviceSignSeed))
    expect(hex(sig)).toBe(hex(bytes(h.hs1Sig)))
    expect(ed25519Verify(sig, bytes(h.hs1SignInput), ed25519Public(bytes(k.deviceSignSeed)))).toBe(true)
    expect(ed25519Verify(sig, bytes(h.hs1SignInput), ed25519Public(bytes(k.hostSignPub)))).toBe(false)
  })

  it('X25519 共享密钥与向量一致（设备侧：deviceEphPriv × hostEphPub）', () => {
    const shared = x25519Shared(bytes(h.deviceEphPriv), bytes(h.hostEphPub))
    expect(hex(shared)).toBe(hex(bytes(h.sharedSecret)))
  })

  it('transcript hash 与向量一致（codync/hs2/v1 ‖ … ‖ ekH）', () => {
    const th = transcriptHash(
      bytes(k.computerId),
      bytes(k.deviceSignPub),
      bytes(h.deviceEphPub),
      bytes(h.n),
      bytes(h.hostEphPub),
    )
    expect(hex(th)).toBe(hex(bytes(h.transcriptHash)))
  })

  it('HKDF 方向密钥 d2h/h2d 与向量一致（salt=transcript hash）', () => {
    const shared = x25519Shared(bytes(h.deviceEphPriv), bytes(h.hostEphPub))
    const th = transcriptHash(
      bytes(k.computerId),
      bytes(k.deviceSignPub),
      bytes(h.deviceEphPub),
      bytes(h.n),
      bytes(h.hostEphPub),
    )
    const keys = channelKeys(shared, th)
    expect(hex(keys.d2h)).toBe(hex(bytes(h.kD2H)))
    expect(hex(keys.h2d)).toBe(hex(bytes(h.kH2D)))
  })

  it('帧向量逐条 seal 一致（方向密钥 + 计数器 + flag 前缀明文）', () => {
    for (const f of vectors.frames as FrameVector[]) {
      const sealed = sealFrame(frameKey(f), f.c, f.final, utf8(f.message))
      expect(hex(sealed)).toBe(hex(bytes(f.d)))
    }
  })

  it('帧向量逐条 open 复原明文（0x00 final / 0x01 more）', () => {
    for (const f of vectors.frames as FrameVector[]) {
      const { last, chunk } = openFrame(frameKey(f), f.c, bytes(f.d))
      expect(last).toBe(f.final)
      expect(new TextDecoder().decode(chunk)).toBe(f.message)
    }
  })

  it('Sealer→Opener 往返：内层消息经多帧重装无损', () => {
    const message = utf8('{"id":9,"m":"send","b":{"text":"你好，codync"}}')
    const frames = new Sealer(bytes(h.kD2H)).seal(message)
    expect(frames).not.toBeNull()
    const opener = new Opener(bytes(h.kD2H))
    let out: Uint8Array | null = null
    for (const frame of frames!) out = opener.open(frame)
    expect(out).not.toBeNull()
    expect(new TextDecoder().decode(out!)).toBe(new TextDecoder().decode(message))
  })

  it('Opener 拒绝乱序计数器与重放 → ChannelCryptoError(protocol)', () => {
    const sealer = new Sealer(bytes(h.kD2H))
    const opener = new Opener(bytes(h.kD2H))
    const frames = sealer.seal(utf8('{"id":1,"m":"hello","b":{}}'))!
    opener.open(frames[0])
    expect(() => opener.open(frames[0])).toThrow(ChannelCryptoError)
    expect(() => opener.open({ t: 'f', c: 5, d: frames[0].d })).toThrow(ChannelCryptoError)
  })
})
