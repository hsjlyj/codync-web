'use client'

/**
 * 搜索页（Phase 2）：本地过滤已加载条目——主机没有全量历史 search 方法（渡口核实），
 * 跨全量历史搜索需主机新增接口后升级。命中跳回对应 Bot 的会话。
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { appModel } from '@/src/client/store/app-model'
import { searchLoadedEntries } from '@/src/client/store/search'
import { useAppModel } from '@/src/client/use-app-model'

const MATCHED_LABEL: Record<string, string> = { text: '正文', file: '附件', artifact: '工件' }

export default function SearchPage() {
  const snap = useAppModel()
  const router = useRouter()
  const [query, setQuery] = useState('')
  // 与 ChatPage 的 modelEntriesOf 同款：直接读模型，entriesVersion 变化触发重渲染时重算。
  const hits = query.trim() ? searchLoadedEntries(snap.bots, (botId) => appModel.entriesOf(botId), query) : []

  const open = (botId: string) => {
    appModel.select(botId)
    router.replace('/client/chat')
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">搜索消息</h1>
        <span className="flex-1" />
        <Link href="/client/chat" className="rounded-xl bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700">
          回聊天
        </Link>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        范围：本会话已加载的消息（正文 / 附件名 / 工件标题），大小写不敏感。跨全量历史搜索需主机新增接口（当前没有 search 方法）。
      </p>

      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="输入关键词，例如 deploy"
        aria-label="搜索关键词"
        className="mt-4 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
      />

      <p className="mt-2 text-xs text-neutral-500" aria-live="polite">
        {query.trim() ? `${hits.length} 条命中` : `已加载 ${snap.bots.filter((b) => !b.hidden).length} 个 Bot 的消息`}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {hits.map(({ bot, entry, matched, snippet }) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => open(bot.id)}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-left hover:border-neutral-600"
            >
              <p className="flex items-center gap-2 text-xs">
                <span className="font-medium text-neutral-200">{bot.name}</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{MATCHED_LABEL[matched] ?? matched}</span>
                <span className="text-neutral-600">{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(entry.createdAt)}</span>
              </p>
              <p className="mt-1 truncate text-sm text-neutral-300">{snippet}</p>
            </button>
          </li>
        ))}
        {query.trim() && hits.length === 0 && (
          <li className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            没有命中的已加载消息。往上翻历史（或先打开对应会话）能扩大可搜范围。
          </li>
        )}
      </ul>
    </main>
  )
}
