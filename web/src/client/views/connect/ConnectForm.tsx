'use client'

/**
 * 连接页（Phase 1）：三种入口
 * - 演示模式：MockTransport，一键进入（验证 UI 数据流）；
 * - 配对：粘贴主机配对链接（codync://pair?...），或手工填地址+computerId+配对码；
 * - 重连：本浏览器已配对过的主机，点一下直连（设备密钥在 IndexedDB，见 device-key.ts）。
 * 连接编排全部在 appModel.connectRealHost，本组件只收集输入与展示阶段。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DeviceCertificate } from '@codync/shared'
import { appModel } from '../../store/app-model'
import { MockTransport } from '../../transport/mock-transport'
import { parsePairingUrl } from '../../transport/pairing-url'
import type { StoredDevice } from '../../transport/device-key'

const inputClass =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500'

type Mode = 'demo' | 'pair' | 'direct'

export function ConnectForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('demo')
  const [device, setDevice] = useState<StoredDevice | null>(null)
  const [pairingLink, setPairingLink] = useState('')
  const [url, setUrl] = useState('')
  const [computerId, setComputerId] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [deviceName, setDeviceName] = useState('Codync Web')
  const [certificateText, setCertificateText] = useState('')
  const [stage, setStage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (appModel.getSnapshot().connection === 'open') router.replace('/client/chat')
    // 已配对设备信息（非机密）用于展示与直连。
    import('../../transport/device-key').then(({ loadDeviceSigner }) => {
      void loadDeviceSigner().then((loaded) => setDevice(loaded?.device ?? null))
    })
  }, [router])

  const linkPreview = pairingLink.trim() ? parsePairingUrl(pairingLink) : null

  const connectDemo = async () => {
    await appModel.connect(new MockTransport())
    router.replace('/client/chat')
  }

  const connectReal = async () => {
    setBusy(true)
    setError(null)
    try {
      let certificate: DeviceCertificate | undefined
      if (certificateText.trim()) {
        try {
          const parsed = JSON.parse(certificateText) as DeviceCertificate
          if (typeof parsed.payload !== 'string' || typeof parsed.sig !== 'string') throw new Error('形状不符')
          certificate = parsed
        } catch {
          throw new Error('设备证书不是 {payload, sig} 的 JSON')
        }
      }
      await appModel.connectRealHost({
        url: url.trim() || undefined,
        pairingLink: mode === 'pair' && pairingLink.trim() ? pairingLink.trim() : undefined,
        pairCode: pairCode.trim() || undefined,
        computerId: computerId.trim() || undefined,
        deviceName: deviceName.trim(),
        certificate,
        onStage: setStage,
      })
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage(null)
    } finally {
      setBusy(false)
    }
  }

  const connectStored = async () => {
    if (!device) return
    setBusy(true)
    setError(null)
    setStage('正在连接主机…')
    try {
      await appModel.connectRealHost({ computerId: device.computerId, onStage: setStage })
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage(null)
    } finally {
      setBusy(false)
    }
  }

  const modes: Array<{ id: Mode; label: string }> = [
    { id: 'demo', label: '演示模式' },
    { id: 'pair', label: '配对新主机' },
    { id: 'direct', label: '直连' },
  ]

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h1 className="text-lg font-semibold text-neutral-100">连接主机</h1>
      <p className="mt-1 text-xs text-neutral-500">
        浏览器直连 /channel E2E（ADR-001）· 设备密钥 WebCrypto non-extractable 优先
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2" role="tablist" aria-label="连接方式">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-lg px-3 py-2 text-sm ${mode === m.id ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'demo' && (
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          本地内存模拟主机：两个 Bot、回声消息、权限卡片。用于在真实主机联调前验证客户端数据流与界面。
        </p>
      )}

      {mode === 'pair' && (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="配对链接（在主机 Codync 桌面端「配对设备」里复制，或扫描 QR 后粘贴链接内容）">
            <textarea
              value={pairingLink}
              onChange={(e) => setPairingLink(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="codync://pair?v=3&name=…&id=…&sk=…&code=…"
            />
          </Field>
          {linkPreview && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              识别成功：{linkPreview.name || '未命名主机'} · computerId {linkPreview.computerId.slice(0, 8)}… · 配对码{' '}
              {linkPreview.code.slice(0, 4)}…
            </p>
          )}
          {!linkPreview && (
            <div className="grid grid-cols-1 gap-3">
              <Field label="或手工：主机地址">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className={inputClass}
                  placeholder="ws://192.168.1.10:19222 或 http://192.168.1.10:19222"
                />
              </Field>
              <Field label="或手工：computerId（16 字节 base64url）">
                <input
                  value={computerId}
                  onChange={(e) => setComputerId(e.target.value)}
                  className={inputClass}
                  placeholder="NHUPmL1Z_PyUbaRaqr6TOw"
                />
              </Field>
              <Field label="或手工：一次性配对码">
                <input
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                  className={inputClass}
                  placeholder="主机上生成"
                />
              </Field>
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300" role="note">
                手工方式没有主机签名公钥（sk）——welcome 签名校验会被跳过，理论上有中间人风险；建议尽量用配对链接（自带
                sk）。
              </p>
            </div>
          )}
          <Field label="设备名称（显示在主机的审批提示里）">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className={inputClass}
              maxLength={100}
            />
          </Field>
          <Field label="设备证书（可选 JSON；主机 2.38 配对要求云签发的 {payload, sig}，缺省会被 4400 拒绝；自托管可用 CODYNC_DEVICE_CERT_KEY 自签）">
            <textarea
              value={certificateText}
              onChange={(e) => setCertificateText(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder='{"payload":"…","sig":"…"}'
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-600">
            平台按 web 登记（主机已支持；较旧主机会自动回退按 macos 过渡一次）。设备密钥生成后以 non-extractable 形式存
            IndexedDB；不支持 Ed25519 的浏览器回退为 AES-GCM 包裹存储。
          </p>
        </div>
      )}

      {mode === 'direct' && (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="主机 /channel 地址">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
              placeholder="ws://192.168.1.10:19222/channel"
            />
          </Field>
          <Field label="computerId">
            <input
              value={computerId}
              onChange={(e) => setComputerId(e.target.value)}
              className={inputClass}
              placeholder="NHUPmL1Z_PyUbaRaqr6TOw"
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-600">
            直连模式使用本浏览器已配对的设备密钥；尚未配对时请先走「配对新主机」。
          </p>
        </div>
      )}

      {device && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5">
          <p className="text-xs text-neutral-300">
            本浏览器已配对：{device.deviceName} · computerId {device.computerId.slice(0, 8)}…
          </p>
          <button
            type="button"
            onClick={() => void connectStored()}
            disabled={busy}
            className="mt-2 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy && stage ? stage : '直接连接'}
          </button>
        </div>
      )}

      {stage && !error && <p className="mt-4 text-xs text-neutral-400">{stage}</p>}
      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      {!device && (
        <button
          type="button"
          onClick={() => void (mode === 'demo' ? connectDemo() : connectReal())}
          disabled={busy || (mode === 'pair' && !pairingLink.trim() && !pairCode.trim())}
          className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (stage ?? '连接中…') : mode === 'demo' ? '进入演示' : '连接'}
        </button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  )
}
