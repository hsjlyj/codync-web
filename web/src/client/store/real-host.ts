/**
 * 真实主机连接编排（自 app-model 纯搬移，不改逻辑）：
 * 1. 载入（或生成并持久化）设备签名密钥（WebCrypto non-extractable 优先，见 device-key.ts）；
 * 2. 给了配对码/配对链接且该主机尚未配对时走配对通道（一次 pair，成功后换普通连接）；
 * 3. 普通 /channel 连接 + 事件订阅（AppModel.connect）。
 * 函数式而非挂在 AppModel 上：它只依赖 model 的公开面（connect/getSnapshot/reportError）。
 */
import type { DeviceCertificate } from '@codync/shared'
import { ChannelTransport } from '../transport/channel-transport'
import { createDeviceSigner, loadDeviceSigner, saveDeviceMeta } from '../transport/device-key'
import { HostError } from '../transport/host-transport'
import { normalizeChannelUrl, parsePairingUrl } from '../transport/pairing-url'
import type { AppModel } from './app-model'

export interface ConnectRealHostParams {
  /** ws(s) 直连地址或 http(s) 主机地址；配对链接内含 urls 时可省略。 */
  url?: string
  /** 完整配对链接（codync://pair?...，含 computerId/sk/code/urls）。 */
  pairingLink?: string
  /** 手工输入的一次性配对码（需同时给 url + computerId）。 */
  pairCode?: string
  computerId?: string
  /** 主机 Ed25519 公钥（welcome 强校验）；配对链接的 sk 优先。 */
  signKey?: string
  deviceName?: string
  /** 云签发的设备证书（主机 2.38 配对必需，缺省将被 4400 拒绝）。 */
  certificate?: DeviceCertificate
  /** 设备平台（主机白名单 ios|macos|android，pairing.rs:35）。 */
  platform?: string
  onStage?: (stage: string) => void
}

export async function connectToRealHost(model: AppModel, params: ConnectRealHostParams): Promise<void> {
  const stage = (s: string) => params.onStage?.(s)
  stage('正在载入设备密钥…')
  const loaded = (await loadDeviceSigner()) ?? (await createDeviceSigner())
  const { signer, device } = loaded

  const parsed = params.pairingLink ? parsePairingUrl(params.pairingLink) : null
  if (params.pairingLink && !parsed) throw new Error('配对链接无法识别：请完整粘贴 codync://pair?... 链接')
  const url = normalizeChannelUrl(params.url ?? parsed?.urls[0] ?? '')
  const computerId = params.computerId?.trim() || parsed?.computerId || device?.computerId || ''
  const signKey = parsed?.signKey || params.signKey?.trim() || undefined
  const pairCode = parsed?.code ?? params.pairCode?.trim()
  if (!url) throw new Error('缺少主机地址（ws://… 或 http://…，或粘贴配对链接）')
  if (!computerId) throw new Error('缺少 computerId（配对链接内含，或手工填写）')

  const alreadyPaired = !!device && device.computerId === computerId
  if (pairCode && !alreadyPaired) {
    stage('正在配对…（请在主机上确认）')
    // 平台按 web 登记（主机白名单已加 web，pairing.rs:35）；老主机只认 ios/macos/android，
    // 平台校验在配对码核销之前（pairing.rs:34-39），被 400 拒后按 macos 过渡重试一次是安全的。
    const pairOnce = async (platform: string) => {
      const pairTransport = new ChannelTransport({
        url,
        computerId,
        hostSignKey: signKey,
        signer,
        clientName: 'web',
        pair: {
          code: pairCode,
          name: params.deviceName?.trim() || 'Codync Web',
          platform,
          ...(params.certificate ? { certificate: params.certificate } : {}),
        },
      })
      try {
        const reply = await pairTransport.pairOutcome()
        await saveDeviceMeta({
          computerId: reply.computerId,
          deviceName: params.deviceName?.trim() || 'Codync Web',
          signPubB64: signer.signPubB64,
          createdAt: Date.now(),
        })
      } finally {
        pairTransport.disconnect()
      }
    }
    try {
      await pairOnce(params.platform ?? 'web')
    } catch (e) {
      if (e instanceof HostError && e.status === 400 && /platform/i.test(e.message)) {
        stage('主机版本较旧，暂按 macos 平台登记…')
        await pairOnce('macos')
      } else {
        throw e
      }
    }
  }

  stage('正在连接主机…')
  const transport = new ChannelTransport({
    url,
    computerId,
    hostSignKey: signKey,
    signer,
    clientName: 'web',
    onStatus: (status, detail) => {
      if (status === 'failed') model.reportError(detail ?? '连接失败')
    },
  })
  await model.connect(transport)
  if (model.getSnapshot().connection !== 'open') throw new Error(model.getSnapshot().lastError ?? '连接失败')
}
