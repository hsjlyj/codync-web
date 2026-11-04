'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Entry } from '@codync/shared'
import { ConnectionBadge } from '@/src/client/components/ConnectionBadge'
import { appModel } from '@/src/client/store/app-model'
import { useAppModel } from '@/src/client/use-app-model'
import { BotRoster } from '@/src/client/views/roster/BotRoster'
import { Composer } from '@/src/client/views/thread/Composer'
import { ThreadView } from '@/src/client/views/thread/ThreadView'

/** 聊天工作区：BotRoster + ThreadView + Composer；回复状态在此持有（桌面端 BotConversation 同构）。 */
export default function ChatPage() {
  const router = useRouter()
  const snap = useAppModel()
  const [reply, setReply] = useState<Entry | null>(null)
  // 切换 Bot 时丢弃跨会话的回复目标（render 期调整状态，避免 effect 里 setState）。
  const [lastBotId, setLastBotId] = useState<string | null>(null)
  if (lastBotId !== snap.selectedBotId) {
    setLastBotId(snap.selectedBotId)
    setReply(null)
  }

  useEffect(() => {
    if (snap.connection === 'idle' || snap.connection === 'closed') router.replace('/client')
  }, [snap.connection, router])

  const selected = snap.selectedBotId ? (snap.bots.find((b) => b.id === snap.selectedBotId) ?? null) : null

  const send = async (
    text: string,
    files: File[],
    replyTo: string | null,
    onProgress: (done: number, total: number) => void,
  ) => {
    const botId = snap.selectedBotId
    if (!botId) throw new Error('未选择 Bot')
    // 先传文件（384KB 分块），拿到附件 id 再随消息发送——顺序与桌面端一致。
    const attachments = files.length ? await appModel.uploadFiles(botId, files, onProgress) : undefined
    await appModel.sendMessage(text, { replyTo: replyTo ?? undefined, attachments })
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <span className="text-sm font-semibold text-neutral-200">Codync Web</span>
        <span className="text-xs text-neutral-500">{snap.hello?.name ?? '未连接主机'}</span>
        <ConnectionBadge connection={snap.connection} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            appModel.disconnect()
            router.replace('/client')
          }}
          className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          断开
        </button>
      </header>
      {snap.lastError && (
        <p className="bg-red-500/10 px-4 py-1.5 text-xs text-red-400" role="alert">
          {snap.lastError}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
          <h2 className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Bots</h2>
          <BotRoster bots={snap.bots} selectedBotId={snap.selectedBotId} onSelect={(id) => appModel.select(id)} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <ThreadView
            entries={modelEntriesOf(snap.selectedBotId)}
            botName={selected?.name ?? null}
            botId={snap.selectedBotId}
            onReply={setReply}
          />
          <Composer
            disabled={!snap.selectedBotId || snap.connection !== 'open'}
            pending={snap.pendingSends > 0}
            reply={reply}
            cancelReply={() => setReply(null)}
            onSend={send}
          />
        </main>
      </div>
    </div>
  )
}

// entriesOf 直接读模型（快照的 entriesVersion 变化触发重渲染）。
import { appModel as model } from '@/src/client/store/app-model'
const modelEntriesOf = (botId: string | null) => model.entriesOf(botId)
