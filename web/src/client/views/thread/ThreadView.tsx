'use client'

/**
 * 聊天主视图（Phase 1）：气泡行 + 权限卡片 + 历史分页。
 * 可见性按主机契约（@codync/shared isChat）：user/permission 全显、agent 仅 final、notice 过滤记忆类。
 * I/O（历史加载、权限回应）走 AppModel，本组件只持有滚动状态。
 */
import { useEffect, useRef, useState } from 'react'
import type { Entry } from '@codync/shared'
import { isChat } from '@codync/shared'
import { appModel } from '../../store/app-model'
import { PermissionCard } from './permission-card'
import { AgentBubble, NoticeRow, UserBubble } from './message-bubbles'

/** 历史页大小（主机 history 上限 500，默认 100；首屏 50 够看，翻页同值）。 */
const HISTORY_PAGE = 50

// 稳定引用（模块级）：气泡 memo 的 props 浅比较才不会被每次渲染的新闭包击穿。
const readUpload = (botId: string, id: string) => appModel.readUploadBytes(botId, id)
const readFile = (entryId: string, id: string) => appModel.readEntryFileBytes(entryId, id)
/** Web 端可引用的行：真实主机条目（非本地占位）的 user/agent final（桌面端 isReplyable 同义）。 */
const isReplyableWeb = (entry: Entry): boolean =>
  !entry.id.startsWith('local-') && (entry.kind === 'user' || (entry.kind === 'agent' && entry.data.final === true))

function EntryRow({
  entry,
  onReply,
  loadArtifact,
}: {
  entry: Entry
  onReply?: (e: Entry) => void
  loadArtifact?: (botId: string, artifactId: string) => Promise<Uint8Array>
}) {
  const reply = onReply && isReplyableWeb(entry) ? onReply : undefined
  switch (entry.kind) {
    case 'user':
      return <UserBubble entry={entry} loadBytes={readUpload} onReply={reply} />
    case 'agent':
      return <AgentBubble entry={entry} loadSharedFile={readFile} loadArtifact={loadArtifact} onReply={reply} />
    case 'permission': {
      const snap = appModel.getSnapshot()
      return (
        <div className="mx-auto w-full max-w-md">
          <PermissionCard
            entry={entry}
            hostName={snap.hello?.name ?? '主机'}
            answering={snap.respondingEntryId === entry.id ? entry.id : null}
            respond={(optionId) => void appModel.respondPermission(entry.id, optionId)}
          />
        </div>
      )
    }
    default:
      return <NoticeRow entry={entry} />
  }
}

export function ThreadView({
  entries,
  botName,
  botId,
  onReply,
  loadArtifact,
}: {
  entries: Entry[]
  botName: string | null
  botId: string | null
  onReply?: (e: Entry) => void
  loadArtifact?: (botId: string, artifactId: string) => Promise<Uint8Array>
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const chat = entries.filter(isChat)
  const count = chat.length
  const loadedBotRef = useRef<string | null>(null)

  // 切到某个 Bot：先拉一页历史 + 清未读（事件流已在追实时，历史只为补更早的记录）。
  useEffect(() => {
    if (!botId || loadedBotRef.current === botId) return
    loadedBotRef.current = botId
    // 历史加载失败不阻塞会话：实时事件仍在推送，重进会话可重试。
    void appModel.loadHistory(botId, undefined, HISTORY_PAGE).catch(() => {})
    void appModel.markRead(botId)
  }, [botId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [count])

  if (!botName || !botId)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        从左侧选择一个 Bot 开始对话
      </div>
    )

  const exhausted = appModel.historyExhaustedOf(botId)

  const loadOlder = async () => {
    setLoadingOlder(true)
    try {
      await appModel.loadHistory(botId, appModel.oldestSeqOf(botId) ?? undefined, HISTORY_PAGE)
    } finally {
      setLoadingOlder(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6" aria-label={`${botName} 的对话`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {!exhausted && (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
            className="mx-auto rounded-full border border-neutral-800 px-4 py-1 text-xs text-neutral-500 hover:border-neutral-700 hover:text-neutral-300 disabled:opacity-50"
          >
            {loadingOlder ? '加载中…' : '加载更早的消息'}
          </button>
        )}
        {count === 0 && <p className="text-center text-sm text-neutral-600">暂无消息记录</p>}
        {chat.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onReply={onReply} loadArtifact={loadArtifact} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
