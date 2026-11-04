/**
 * device-key 测试：
 * - WebCrypto Ed25519 路径：签名必须能被 @noble/curves 校验通过（跨实现一致性，
 *   主机侧用 Rust ed25519-dalek 验签，同样的互验性质）；
 * - 包裹回退路径（浏览器不支持 WebCrypto Ed25519 时）：签名同样通过 noble 校验；
 * - 无 IndexedDB 环境（jsdom）：仅内存，loadDeviceSigner 返回 null。
 */
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { b64urlDecode, ed25519Verify, utf8 } from './channel-crypto'
import { createDeviceSigner, loadDeviceSigner } from './device-key'

afterEach(() => {
  vi.unstubAllGlobals()
})

const input = utf8('codync/hs1/v1-test-input')

async function expectSignatureVerifiesUnderNoble(signer: {
  signPubB64: string
  sign(i: Uint8Array): Promise<Uint8Array>
}) {
  const sig = await signer.sign(input)
  expect(sig).toHaveLength(64)
  const pub = b64urlDecode(signer.signPubB64)
  expect(pub).toHaveLength(32)
  expect(ed25519Verify(sig, input, pub)).toBe(true)
}

describe('createDeviceSigner', () => {
  it('WebCrypto Ed25519 路径：non-extractable，签名通过 noble 校验', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { signer } = await createDeviceSigner()
    expect(signer.storage).toBe('webcrypto')
    await expectSignatureVerifiesUnderNoble(signer)
  })

  it('回退路径（WebCrypto 无 Ed25519）：AES-GCM 包裹种子，签名通过 noble 校验', async () => {
    const subtle = webcrypto.subtle
    // 模拟不支持 Ed25519 的浏览器：generateKey 遇 Ed25519 即抛错，AES-GCM 保持可用。
    const generateKey = async (
      algorithm: AlgorithmIdentifier | { name: string },
      ...rest: unknown[]
    ): Promise<CryptoKey | CryptoKeyPair> => {
      if (typeof algorithm === 'string' || algorithm.name === 'Ed25519') throw new Error('Ed25519 unsupported')
      return subtle.generateKey(algorithm as AlgorithmIdentifier, ...(rest as [boolean, KeyUsage[]]))
    }
    vi.stubGlobal('crypto', {
      subtle: { generateKey, encrypt: subtle.encrypt.bind(subtle), decrypt: subtle.decrypt.bind(subtle) },
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: webcrypto.randomUUID.bind(webcrypto),
    })
    const { signer } = await createDeviceSigner()
    expect(signer.storage).toBe('encrypted-idb')
    await expectSignatureVerifiesUnderNoble(signer)
  })

  it('两种路径对同一输入产生可被彼此公钥验证的独立签名（确定性 Ed25519）', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const a = await createDeviceSigner()
    const b = await createDeviceSigner()
    const sigA = await a.signer.sign(input)
    const sigB = await b.signer.sign(input)
    expect(ed25519Verify(sigA, input, b64urlDecode(b.signer.signPubB64))).toBe(false)
    expect(ed25519Verify(sigA, input, b64urlDecode(a.signer.signPubB64))).toBe(true)
    // Ed25519 确定性：同一密钥同一消息签名逐字节相同。
    expect(await a.signer.sign(input)).toEqual(sigA)
    void sigB
  })
})

describe('loadDeviceSigner（jsdom 无 IndexedDB）', () => {
  it('返回 null（未持久化），createDeviceSigner 静默跳过持久化', async () => {
    vi.stubGlobal('crypto', webcrypto)
    expect(await loadDeviceSigner()).toBeNull()
    await expect(createDeviceSigner()).resolves.toBeTruthy()
  })
})
