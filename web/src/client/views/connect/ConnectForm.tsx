'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { b64urlEncode, randomBytes, utf8 } from '../../transport/channel-crypto'
import { ChannelTransport } from '../../transport/channel-transport'
import { MockTransport } from '../../transport/mock-transport'
import { appModel } from '../../store/app-model'

/**
 * Phase 0 连接页。
 * - 演示模式：MockTransport，一键进入，验证完整 UI 数据流。
 * - 真实主机：/channel E2E，需要 computerId + 设备密钥（配对流程 Phase 1 接入；
 *   本阶段从输入框带参，device key 仅内存/会话存储，砚边审计口径）。
 */
export function ConnectForm() {
  const router = useRouter()
  const [mode, setMode] = useState<'demo' | 'channel'>('demo')
  const [url, setUrl] = useState('ws://localhost:19222/channel')
  const [computerId, setComputerId] = useState('')
  const [hostSignKey, setHostSignKey] = useState('')
  const [seedB64, setSeedB64] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (appModel.getSnapshot().connection === 'open') router.replace('/client/chat')
  }, [router])

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'demo') {
        await appModel.connect(new MockTransport())
      } else {
        if (!url.trim() || !computerId.trim() || !seedB64.trim()) throw new Error('地址、computerId 与设备密钥都不能为空')
        const seed = decodeSeed(seedB64.trim())
        const transport = new ChannelTransport({
          url: url.trim(),
          computerId: computerId.trim(),
          deviceSignSeed: seed,
          hostSignKey: hostSignKey.trim() || undefined,
          clientName: 'web',
          onStatus: (status, detail) => {
            if (status === 'failed') setError(detail ?? '连接失败')
          },
        })
        await appModel.connect(transport)
        if (appModel.getSnapshot().connection !== 'open') throw new Error(appModel.getSnapshot().lastError ?? '连接失败')
      }
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h1 className="text-lg font-semibold text-neutral-100">连接主机</h1>
      <p className="mt-1 text-xs text-neutral-500">Phase 0 脚手架 · 方案 A：浏览器直连 /channel E2E（ADR-001）</p>

      <div className="mt-5 grid grid-cols-2 gap-2" role="tablist" aria-label="连接方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'demo'}
          onClick={() => setMode('demo')}
          className={`rounded-lg px-3 py-2 text-sm ${mode === 'demo' ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800'}`}
        >
          演示模式
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'channel'}
          onClick={() => setMode('channel')}
          className={`rounded-lg px-3 py-2 text-sm ${mode === 'channel' ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800'}`}
        >
          真实主机 /channel
        </button>
      </div>

      {mode === 'demo' ? (
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          本地内存模拟主机：一个 hello、两个 Bot、回声消息。用于在 E2E 握手联调前验证客户端数据流与界面。
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Field label="主机 /channel 地址">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} placeholder="ws://192.168.1.10:19222/channel" />
          </Field>
          <Field label="computerId（16 字节 base64url）">
            <input value={computerId} onChange={(e) => setComputerId(e.target.value)} className={inputClass} placeholder="NHUPmL1Z_PyUbaRaqr6TOw" />
          </Field>
          <Field label="设备密钥种子（32 字节 base64url，仅本次会话）">
            <div className="flex gap-2">
              <input value={seedB64} onChange={(e) => setSeedB64(e.target.value)} className={inputClass} placeholder="粘贴或点右侧生成" />
              <button
                type="button"
                onClick={() => setSeedB64(b64urlEncode(randomBytes(32)))}
                className="shrink-0 rounded-lg bg-neutral-800 px-3 text-xs text-neutral-300 hover:bg-neutral-700"
              >
                生成
              </button>
            </div>
          </Field>
          <Field label="主机公钥（可选，提供则强校验 welcome 签名）">
            <input value={hostSignKey} onChange={(e) => setHostSignKey(e.target.value)} className={inputClass} placeholder="base64url" />
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-600">
            配对码流程 Phase 1 接入。会话存储仅保连接参数，不含密钥；刷新页面后需重新输入。
          </p>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={() => void connect()}
        disabled={busy}
        className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? '连接中…' : '连接'}
      </button>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500'

function decodeSeed(text: string): Uint8Array {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  if (out.length !== 32) throw new Error(`设备密钥种子应为 32 字节，收到 ${out.length} 字节`)
  return out
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

void utf8
