/**
 * `/channel` 加密原语 —— 与主机 `host/src/remote/crypto.rs` 逐字节对齐。
 * 实现依据（源码为准，非转述）：
 * - hs1_input    crypto.rs:104-106  `codync/hs1/v1` || cidRaw || dk || ekD || n
 * - transcript   crypto.rs:109-111  sha256(`codync/hs2/v1` || cidRaw || dk || ekD || n || ekH)
 * - channel_keys crypto.rs:120-127  HKDF-SHA256(ikm=shared, salt=TH) → `codync/d2h/v1` / `codync/h2d/v1`
 * - seal/open    crypto.rs:129-159  ChaCha20-Poly1305；nonce=12B（前 4B 零 + 计数器 u64 大端）；
 *                                   AAD=`codync/frame/v1`||计数器；明文首字节为 FLAG_FINAL(0)/FLAG_MORE(1)
 * - Sealer/Opener crypto.rs:162-232 计数器从 0 起；分帧 ≤256KiB；收到乱序计数器 → 协议错误
 * 回归基线：docs/reference/fixtures/remote-relay-vectors.json（Codync 官方测试向量）。
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

export const HS1_LABEL = 'codync/hs1/v1'
export const HS2_LABEL = 'codync/hs2/v1'
export const FRAME_AAD_LABEL = 'codync/frame/v1'
const D2H_INFO = 'codync/d2h/v1'
const H2D_INFO = 'codync/h2d/v1'

export const FLAG_FINAL = 0x00
export const FLAG_MORE = 0x01

/** 单帧明文上限（crypto.rs CHUNK）。 */
export const CHUNK = 256 * 1024
/** 帧计数器上限，达到必须重连换钥（close 4011）。 */
export const REKEY_AT = 2 ** 32
/** 重装后的入站消息上限（channel.rs MAX_INBOUND）。 */
export const MAX_INBOUND = 8 * 1024 * 1024

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const te = new TextEncoder()
export const utf8 = (s: string): Uint8Array => te.encode(s)

/** base64url（无填充），与主机 crypto.rs 的 `b64`/`unb64` 一致。 */
export const b64urlEncode = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export const b64urlDecode = (text: string): Uint8Array => {
  let s = text.replaceAll('-', '+').replaceAll('_', '/')
  while (s.length % 4) s += '='
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

// MARK: 握手

/** 主机 cid 的 16 字节原始值（`computerId` 为其 base64url 编码）。 */
export const cidRawOf = (computerId: string): Uint8Array => {
  const raw = b64urlDecode(computerId)
  if (raw.length !== 16) throw new Error(`computerId 应为 16 字节的 base64url（收到 ${raw.length} 字节）`)
  return raw
}

/** 设备在 `hello` 里签的内容（crypto.rs hs1_input）。 */
export const hs1Input = (cidRaw: Uint8Array, dk: Uint8Array, ekD: Uint8Array, n: Uint8Array): Uint8Array =>
  concat(utf8(HS1_LABEL), cidRaw, dk, ekD, n)

/** transcript hash：`welcome` 的签名内容，也是 HKDF salt（crypto.rs transcript_hash）。 */
export const transcriptHash = (
  cidRaw: Uint8Array,
  dk: Uint8Array,
  ekD: Uint8Array,
  n: Uint8Array,
  ekH: Uint8Array,
): Uint8Array => sha256(concat(utf8(HS2_LABEL), cidRaw, dk, ekD, n, ekH))

export interface ChannelKeys {
  d2h: Uint8Array
  h2d: Uint8Array
}

/** 方向密钥（crypto.rs channel_keys）。 */
export const channelKeys = (shared: Uint8Array, th: Uint8Array): ChannelKeys => ({
  d2h: hkdf(sha256, shared, th, utf8(D2H_INFO), 32),
  h2d: hkdf(sha256, shared, th, utf8(H2D_INFO), 32),
})

export const ed25519Public = (seed: Uint8Array): Uint8Array => ed25519.getPublicKey(seed)
export const ed25519Sign = (message: Uint8Array, seed: Uint8Array): Uint8Array => ed25519.sign(message, seed)
export const ed25519Verify = (sig: Uint8Array, message: Uint8Array, pubKey: Uint8Array): boolean =>
  ed25519.verify(sig, message, pubKey)
export const x25519Public = (privKey: Uint8Array): Uint8Array => x25519.getPublicKey(privKey)
export const x25519Shared = (privKey: Uint8Array, theirPub: Uint8Array): Uint8Array =>
  x25519.getSharedSecret(privKey, theirPub)
export const randomX25519Private = (): Uint8Array => x25519.utils.randomPrivateKey()

// MARK: 帧

const frameNonce = (c: number): Uint8Array => {
  const n = new Uint8Array(12)
  const view = new DataView(n.buffer)
  view.setBigUint64(4, BigInt(c), false)
  return n
}

const frameAad = (c: number): Uint8Array => {
  const tail = new Uint8Array(8)
  new DataView(tail.buffer).setBigUint64(0, BigInt(c), false)
  return concat(utf8(FRAME_AAD_LABEL), tail)
}

/** 加密一帧（crypto.rs seal_frame）：返回密文（含 16B tag）。 */
export const sealFrame = (key: Uint8Array, c: number, last: boolean, chunk: Uint8Array): Uint8Array => {
  const plain = concat(new Uint8Array([last ? FLAG_FINAL : FLAG_MORE]), chunk)
  return chacha20poly1305(key, frameNonce(c), frameAad(c)).encrypt(plain)
}

/** 解一帧（crypto.rs open_frame）。签名/计数器错都抛 `ChannelCryptoError`。 */
export const openFrame = (key: Uint8Array, c: number, d: Uint8Array): { last: boolean; chunk: Uint8Array } => {
  let plain: Uint8Array
  try {
    plain = chacha20poly1305(key, frameNonce(c), frameAad(c)).decrypt(d)
  } catch {
    throw new ChannelCryptoError('协议错误', 'protocol')
  }
  if (plain.length < 1) throw new ChannelCryptoError('空帧', 'protocol')
  const flag = plain[0]
  const chunk = plain.slice(1)
  if (flag === FLAG_FINAL) return { last: true, chunk }
  if (flag === FLAG_MORE) return { last: false, chunk }
  throw new ChannelCryptoError('未知帧标志', 'protocol')
}

export class ChannelCryptoError extends Error {
  constructor(
    message: string,
    readonly kind: 'protocol' | 'tooLarge' | 'rekey',
  ) {
    super(message)
  }
}

// MARK: Sealer / Opener

/** 线上帧：`{"t":"f","c":<计数器>,"d":<base64url 密文>}`。 */
export interface FrameJson {
  t: 'f'
  c: number
  d: string
}

/** 发送方向（crypto.rs Sealer）：计数器从 0 起，可把一条消息分成多帧。 */
export class Sealer {
  private next = 0

  constructor(readonly key: Uint8Array) {}

  /** 编码一条内层消息为若干 `f` 帧；达到计数器上限返回 null（必须重连换钥）。 */
  seal(message: Uint8Array): FrameJson[] | null {
    const chunks = message.length === 0 ? [new Uint8Array(0)] : slicesOf(message, CHUNK)
    if (this.next + chunks.length > REKEY_AT) return null
    return chunks.map((chunk, i) => {
      const c = this.next
      this.next += 1
      return { t: 'f' as const, c, d: b64urlEncode(sealFrame(this.key, c, i + 1 === chunks.length, chunk)) }
    })
  }
}

const slicesOf = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, at + size))
  return out
}

/** 接收方向（crypto.rs Opener）：要求计数器连续，按 last 标志重装整条消息。 */
export class Opener {
  private next = 0
  private buf: Uint8Array[] = []
  private buffered = 0

  constructor(
    readonly key: Uint8Array,
    readonly limit = MAX_INBOUND,
  ) {}

  /** 喂入一帧；凑齐一条完整消息时返回其字节，否则返回 null。 */
  open(frame: unknown): Uint8Array | null {
    if (this.next >= REKEY_AT) throw new ChannelCryptoError('计数器用尽', 'rekey')
    const f = frame as Partial<FrameJson> | null
    if (!f || f.t !== 'f' || typeof f.c !== 'number' || typeof f.d !== 'string')
      throw new ChannelCryptoError('帧格式错误', 'protocol')
    if (f.c !== this.next) throw new ChannelCryptoError(`帧计数器不连续（期望 ${this.next}，收到 ${f.c}）`, 'protocol')
    const { last, chunk } = openFrame(this.key, f.c, b64urlDecode(f.d))
    this.next += 1
    this.buf.push(chunk)
    this.buffered += chunk.length
    if (this.buffered > this.limit) throw new ChannelCryptoError('消息超出大小上限', 'tooLarge')
    if (!last) return null
    const message = concat(...this.buf)
    this.buf = []
    this.buffered = 0
    return message
  }
}
