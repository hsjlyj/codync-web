'use client'

/**
 * 设置页（Phase 2）：连接信息、本机设备密钥状态（含「断开并清除本机密钥」）、用量统计、Agent 后端。
 * I/O：fetchUsage（store/usage.ts）与 loadDeviceSigner（transport/device-key.ts）由页面编排。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Usage } from '@codync/shared'
import { ConnectionBadge } from '@/src/client/components/ConnectionBadge'
import { appModel } from '@/src/client/store/app-model'
import { fetchUsage } from '@/src/client/store/usage'
import { loadDeviceSigner } from '@/src/client/transport/device-key'
import { useAppModel } from '@/src/client/use-app-model'

const dateOf = (ms: number) => (ms ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ms) : '—')

export default function SettingsPage() {
  const snap = useAppModel()
  const router = useRouter()
  const connected = snap.connection === 'open'

  const [device, setDevice] = useState<{
    name: string
    computerId: string | null
    storage: string
    since: number
  } | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [usageBusy, setUsageBusy] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadDeviceSigner().then((loaded) => {
      if (!alive || !loaded) return
      setDevice({
        name: loaded.device?.deviceName ?? '（未配对过主机）',
        computerId: loaded.device?.computerId ?? null,
        storage: loaded.signer.storage,
        since: loaded.device?.createdAt ?? 0,
      })
    })
    return () => {
      alive = false
    }
  }, [])

  const loadUsage = async (refresh: boolean) => {
    setUsageBusy(true)
    setUsageError(null)
    try {
      setUsage(await fetchUsage(appModel, refresh))
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : String(e))
    } finally {
      setUsageBusy(false)
    }
  }

  useEffect(() => {
    if (connected) void loadUsage(false)
    // 只在连接建立时取一次用量；手动刷新走按钮。
  }, [connected])

  const clearKeys = async () => {
    setError(null)
    try {
      // 风落的验收故事：断开连接后清除本地密钥（device key + 配对元数据一并清）。
      appModel.disconnect()
      await appModel.forgetDevice()
      router.replace('/client')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfirmClear(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">设置</h1>
        <span className="flex-1" />
        <Link
          href="/client/chat"
          className="rounded-xl bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          回聊天
        </Link>
      </div>
      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <Card title="连接">
        <Row label="主机">{snap.hello?.name ?? '未连接'}</Row>
        <Row label="状态">
          <span className="flex items-center gap-2">
            <ConnectionBadge connection={snap.connection} />
            {snap.statusDetail ? <span className="text-neutral-500">{snap.statusDetail}</span> : null}
          </span>
        </Row>
        {snap.hello && (
          <>
            <Row label="版本">{snap.hello.version}</Row>
            <Row label="系统">{snap.hello.os}</Row>
            <Row label="computerId">
              <span className="break-all font-mono text-xs text-neutral-400">{snap.hello.computerId}</span>
            </Row>
          </>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              appModel.disconnect()
              router.replace('/client')
            }}
            className="rounded-xl bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            断开连接
          </button>
          <button
            type="button"
            onClick={() => (confirmClear ? void clearKeys() : setConfirmClear(true))}
            className={`rounded-xl px-4 py-2 text-sm ${confirmClear ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
          >
            {confirmClear ? '确认清除？（下次需重新配对）' : '断开并清除本机密钥'}
          </button>
          {confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-xl bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
            >
              取消
            </button>
          )}
        </div>
      </Card>

      <Card title="本机设备">
        {device ? (
          <>
            <Row label="设备名">{device.name}</Row>
            <Row label="密钥形态">
              {device.storage === 'webcrypto'
                ? 'WebCrypto non-extractable Ed25519（私钥不可导出）'
                : device.storage === 'encrypted-idb'
                  ? 'AES-GCM 包裹种子（IndexedDB，非明文）'
                  : '仅内存（本次会话，刷新即失）'}
            </Row>
            <Row label="配对时间">{device.since ? dateOf(device.since) : '—'}</Row>
            <Row label="computerId">
              <span className="break-all font-mono text-xs text-neutral-400">{device.computerId ?? '—'}</span>
            </Row>
          </>
        ) : (
          <p className="text-xs text-neutral-500">读取本机设备信息中…</p>
        )}
      </Card>

      <Card
        title="用量"
        action={
          <button
            type="button"
            disabled={!connected || usageBusy}
            onClick={() => void loadUsage(true)}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            {usageBusy ? '刷新中…' : '强制刷新（向 agent 现取）'}
          </button>
        }
      >
        {!connected && <p className="text-xs text-neutral-500">连接主机后可查看各 agent 的用量窗口。</p>}
        {usageError && (
          <p className="text-xs text-red-400" role="alert">
            {usageError}
          </p>
        )}
        {connected && usage?.providers.length === 0 && (
          <p className="text-xs text-neutral-500">主机暂无用量数据（agent 未上报）。</p>
        )}
        {usage?.providers.map((provider) => (
          <div key={provider.id} className="mt-2 first:mt-0">
            <p className="text-xs font-medium text-neutral-200">{provider.name}</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {provider.windows.map((window) => (
                <li key={window.id} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-xs text-neutral-400">{window.label}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800">
                    <span
                      className={`block h-full rounded-full ${window.percent >= 90 ? 'bg-red-500' : window.percent >= 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(Math.max(window.percent, 0), 100)}%` }}
                    />
                  </span>
                  <span className="w-28 shrink-0 text-right text-xs text-neutral-400">
                    {window.text ?? `${Math.round(window.percent)}%`}
                    {window.resetsText ? (
                      <span className="block text-[10px] text-neutral-600">{window.resetsText}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>

      <Card title="Agent 后端">
        {(snap.hello?.backends ?? []).length === 0 && (
          <p className="text-xs text-neutral-500">连接主机后显示已装后端。</p>
        )}
        <ul className="flex flex-col gap-2">
          {(snap.hello?.backends ?? []).map((backend) => (
            <li key={backend.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-200">{backend.name || backend.id}</span>
              {backend.installed && <Badge tone="good">已安装</Badge>}
              {backend.signedIn && <Badge tone="good">已登录</Badge>}
              {!backend.available && <Badge tone="bad">不可用</Badge>}
              {!backend.available && backend.installHint ? (
                <span className="truncate text-neutral-600">{backend.installHint}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        <span className="flex-1" />
        {action}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1 text-neutral-200">{children}</span>
    </p>
  )
}

function Badge({ tone, children }: { tone: 'good' | 'bad'; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${tone === 'good' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
    >
      {children}
    </span>
  )
}
