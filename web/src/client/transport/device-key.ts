/**
 * 设备密钥管理（Phase 1）：Ed25519 设备签名密钥的生成、持久化与使用。
 * 安全口径（砚边审计，web/docs/review-checklist.md「安全性」）：
 * - 优先 WebCrypto non-extractable Ed25519：私钥永不可导出，CryptoKey 直接入 IndexedDB；
 * - 浏览器不支持 Ed25519 时回退：@noble 生成 32B 种子，AES-GCM（non-extractable 包裹密钥）加密后入 IndexedDB，
 *   静态存储非明文；包裹密钥本身无法导出，明文种子仅在会话内存中存在；
 * - IndexedDB 不可用（隐私模式等）时仅内存持有，刷新后需重新配对。
 * 边界：包裹密钥仍可被同源脚本调用 decrypt——回退路径的强度以「静态非明文」为限，不抗同源 XSS。
 */
import { b64urlEncode, ed25519Public, ed25519Sign, randomBytes } from './channel-crypto'

export interface DeviceSigner {
  /** Ed25519 公钥 base64url（hello 的 `dk` 字段）。 */
  readonly signPubB64: string
  /** 对握手输入（hs1_input）签名。 */
  sign(input: Uint8Array): Promise<Uint8Array>
  /** 密钥的存储形态（连接页展示用）。 */
  readonly storage: 'webcrypto' | 'encrypted-idb' | 'memory'
}

/** 一台主机的已配对设备信息（非机密，可持久化展示）。 */
export interface StoredDevice {
  computerId: string
  deviceName: string
  signPubB64: string
  createdAt: number
}

const DB_NAME = 'codync-web'
const STORE = 'device'
const KEY = 'device'

interface DeviceRecord {
  computerId: string | null
  deviceName: string | null
  createdAt: number
  signPubB64: string
  /** 路径 A：non-extractable Ed25519 私钥 + 公钥，两者都入 IndexedDB。 */
  ed25519?: { privateKey: CryptoKey; publicKey: CryptoKey }
  /** 路径 B：AES-GCM 包裹的种子 + non-extractable 包裹密钥。 */
  wrapped?: { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer>; wrapKey: CryptoKey }
}

class WebCryptoSigner implements DeviceSigner {
  readonly storage = 'webcrypto' as const
  constructor(
    private readonly privateKey: CryptoKey,
    readonly signPubB64: string,
  ) {}
  sign(input: Uint8Array): Promise<Uint8Array> {
    // noble 返回 Uint8Array<ArrayBufferLike>；WebCrypto 需要 ArrayBuffer 背书的视图（零拷贝重视图）。
    const view = new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength)
    return crypto.subtle.sign('Ed25519', this.privateKey, view).then((sig) => new Uint8Array(sig))
  }
}

class NobleSigner implements DeviceSigner {
  readonly storage = 'encrypted-idb' as const
  constructor(
    private readonly seed: Uint8Array,
    readonly signPubB64: string,
  ) {}
  sign(input: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(ed25519Sign(input, this.seed))
  }
}

// MARK: 对外 API

/** 读回已持久化的设备签名者；没有可用密钥（未配对/浏览器清库/结构损坏）返回 null。 */
export async function loadDeviceSigner(): Promise<{ signer: DeviceSigner; device: StoredDevice | null } | null> {
  const record = await readRecord()
  if (!record) return null
  if (record.ed25519) {
    const signer = new WebCryptoSigner(record.ed25519.privateKey, record.signPubB64)
    return { signer, device: deviceOf(record) }
  }
  if (record.wrapped) {
    const seed = await unwrapSeed(record.wrapped)
    const signer = new NobleSigner(seed, record.signPubB64)
    return { signer, device: deviceOf(record) }
  }
  return null
}

/** 生成并持久化新的设备密钥；IndexedDB 不可用时退回仅内存（刷新后需重新配对）。 */
export async function createDeviceSigner(): Promise<{ signer: DeviceSigner; device: StoredDevice | null }> {
  const record: DeviceRecord = { computerId: null, deviceName: null, createdAt: Date.now(), signPubB64: '' }
  if (await webcryptoEd25519Available()) {
    const pair = (await crypto.subtle.generateKey('Ed25519', false, ['sign'])) as CryptoKeyPair
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    record.signPubB64 = b64urlEncode(new Uint8Array(rawPub))
    record.ed25519 = { privateKey: pair.privateKey, publicKey: pair.publicKey }
    await writeRecord(record)
    return { signer: new WebCryptoSigner(pair.privateKey, record.signPubB64), device: null }
  }
  const seed = randomBytes(32)
  record.signPubB64 = b64urlEncode(ed25519Public(seed))
  record.wrapped = await wrapSeed(seed)
  await writeRecord(record)
  return { signer: new NobleSigner(seed, record.signPubB64), device: null }
}

/** 配对成功后登记主机信息（computerId 等非机密字段）。 */
export async function saveDeviceMeta(device: StoredDevice): Promise<void> {
  const record = await readRecord()
  if (!record) return
  record.computerId = device.computerId
  record.deviceName = device.deviceName
  record.createdAt = device.createdAt
  record.signPubB64 = device.signPubB64
  await writeRecord(record)
}

/** 忘记本机设备（主机侧 revoke 后调用）：删掉本地密钥，下次需重新配对。 */
export async function clearDevice(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY))
  db.close()
}

// MARK: 加密包裹（回退路径）

async function webcryptoEd25519Available(): Promise<boolean> {
  if (typeof crypto?.subtle === 'undefined') return false
  try {
    await crypto.subtle.generateKey('Ed25519', false, ['sign'])
    return true
  } catch {
    return false
  }
}

async function wrapSeed(seed: Uint8Array): Promise<NonNullable<DeviceRecord['wrapped']>> {
  const wrapKey = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])) as CryptoKey
  const ivRaw = randomBytes(12)
  const iv = new Uint8Array(ivRaw.buffer as ArrayBuffer, ivRaw.byteOffset, ivRaw.byteLength)
  const seedView = new Uint8Array(seed.buffer as ArrayBuffer, seed.byteOffset, seed.byteLength)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, seedView))
  return { iv, data: sealed, wrapKey }
}

async function unwrapSeed(wrapped: {
  iv: Uint8Array<ArrayBuffer>
  data: Uint8Array<ArrayBuffer>
  wrapKey: CryptoKey
}): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv }, wrapped.wrapKey, wrapped.data)
  return new Uint8Array(plain)
}

function deviceOf(record: DeviceRecord): StoredDevice | null {
  if (!record.computerId) return null
  return {
    computerId: record.computerId,
    deviceName: record.deviceName ?? 'Web 设备',
    signPubB64: record.signPubB64,
    createdAt: record.createdAt,
  }
}

// MARK: IndexedDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('IndexedDB 打开失败'))
  })
}

function readRecord(): Promise<DeviceRecord | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return openDb()
    .then((db) => request(db.transaction(STORE).objectStore(STORE).get(KEY)).finally(() => db.close()))
    .then((value) =>
      value && typeof value === 'object' && typeof (value as DeviceRecord).signPubB64 === 'string'
        ? (value as DeviceRecord)
        : null,
    )
    .catch(() => null)
}

function writeRecord(record: DeviceRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return openDb()
    .then((db) =>
      request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, KEY)).finally(() => db.close()),
    )
    .then(() => undefined)
    .catch(() => undefined)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
  })
}
