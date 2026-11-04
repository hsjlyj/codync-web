'use client'

/**
 * Bot 管理控制台（Phase 2）：花名册全量列表（含隐藏）+ 编辑入口 + 隐藏/删除 + section 重命名。
 * I/O 走 appModel.admin（store 层），页面只编排与持表单态。
 */
import { useState } from 'react'
import Link from 'next/link'
import type { Bot } from '@codync/shared'
import { draftOf } from '@codync/shared'
import { appModel } from '@/src/client/store/app-model'
import { useAppModel } from '@/src/client/use-app-model'
import { avatarHex } from '@/src/client/views/bots/avatar-choices'

export default function BotsPage() {
  const snap = useAppModel()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)

  const connected = snap.connection === 'open'
  const sections = [...new Set(snap.bots.map((b) => b.section).filter((s): s is string => !!s))]

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleHidden = (bot: Bot) => act(() => appModel.admin.updateBot({ ...draftOf(bot), hidden: !bot.hidden }))

  const remove = (bot: Bot) =>
    act(async () => {
      await appModel.admin.deleteBot(bot.id)
      if (snap.selectedBotId === bot.id) appModel.select(null)
      setConfirmId(null)
    })

  const rename = () => {
    if (!renaming) return
    void act(async () => {
      // 主机语义（bots.rs:105-107）：`to` 缺失会被拒绝而非当 null——清空必须显式传 null。
      await appModel.admin.renameSection(renaming.from, renaming.to.trim() || null)
      setRenaming(null)
    })
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Bot 管理</h1>
        <span className="flex-1" />
        <Link
          href="/client/bots/new"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          ＋ 新建 Bot
        </Link>
        <Link
          href="/client/chat"
          className="rounded-xl bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          回聊天
        </Link>
      </div>

      {!connected && (
        <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-400">
          未连接主机。先在
          <Link href="/client" className="mx-1 text-emerald-400 hover:underline">
            连接页
          </Link>
          连接（或进演示模式），Bot 列表来自主机事件流。
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {snap.bots.map((bot) => (
          <li key={bot.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: avatarHex(bot.avatarColor) }}
                aria-hidden
              >
                {bot.name.slice(0, 1) || '?'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-100">
                  {bot.name}
                  {bot.hidden && (
                    <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      已隐藏
                    </span>
                  )}
                  {bot.section && (
                    <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {bot.section}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {bot.backend} · {bot.cwd || '个人工作区'} · {bot.permission === 'auto' ? '自动权限' : '询问权限'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <Link
                  href={`/client/bots/edit?bot=${encodeURIComponent(bot.id)}`}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700"
                >
                  编辑
                </Link>
                <button
                  type="button"
                  disabled={busy || !connected}
                  onClick={() => void toggleHidden(bot)}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                >
                  {bot.hidden ? '显示' : '隐藏'}
                </button>
                <button
                  type="button"
                  disabled={busy || !connected}
                  onClick={() => setConfirmId(bot.id === confirmId ? null : bot.id)}
                  aria-expanded={bot.id === confirmId}
                  className={`rounded-lg px-3 py-1.5 disabled:opacity-50 ${bot.id === confirmId ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                >
                  {bot.id === confirmId ? '确认删除？' : '删除'}
                </button>
                {bot.id === confirmId && (
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
            {bot.id === confirmId && (
              <p className="mt-2 border-t border-neutral-800 pt-2 text-xs text-neutral-500">
                删除是软删：主机停掉它的会话并从花名册移除（deleted 事件），聊天记录同时清空。
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(bot)}
                  className="ml-2 rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-500 disabled:opacity-50"
                >
                  确认删除
                </button>
              </p>
            )}
          </li>
        ))}
        {connected && snap.bots.length === 0 && (
          <li className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            还没有 Bot——点右上角「新建 Bot」创建第一个。
          </li>
        )}
      </ul>

      {sections.length > 0 && (
        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4" aria-label="分组管理">
          <h2 className="text-sm font-medium text-neutral-200">分组管理</h2>
          <p className="mt-1 text-xs text-neutral-500">
            重命名会一并更新组内全部 Bot；清空名称 = 解散分组（roster 里可拖拽移动分组）。
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {sections.map((section) => (
              <li key={section} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-neutral-300">{section}</span>
                <input
                  value={renaming?.from === section ? renaming.to : section}
                  onChange={(e) => setRenaming({ from: section, to: e.target.value })}
                  disabled={busy || !connected}
                  aria-label={`重命名分组 ${section}`}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                />
                <button
                  type="button"
                  disabled={busy || !connected || renaming?.from !== section}
                  onClick={rename}
                  className="shrink-0 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                >
                  保存
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
