'use client'

/**
 * 消息气泡（桌面端 ChatRows.tsx 的 Web 子集，Phase 1）：
 * user（右对齐，附件+引用+状态）、agent（左对齐，Markdown/文件/artifact 卡）、notice（居中细行，error 样式）。
 * 群聊作者标签、表情回应、右键菜单属 Phase 2（桌面端 ReactionsRow/AnchoredMenu 对应物）。
 */
import { memo, useState } from 'react'
import type { Entry, ReplyQuote } from '@codync/shared'
import { MarkdownText } from './markdown'
import { AttachmentList, SharedFileList } from './attachment-list'

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** 引用行：被回复消息的首行预览（桌面端 QuoteRow 同构）。 */
export function QuoteRow({ quote }: { quote: ReplyQuote }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded border-l-2 border-neutral-500 bg-neutral-800/60 px-2 py-1">
      <span aria-hidden className="text-[10px] text-neutral-500">
        💬
      </span>
      <span className="min-w-0 truncate text-[11px] text-neutral-400">
        {quote.text ? `“${quote.text}”` : '（附件消息）'}
      </span>
    </div>
  )
}

function UserStatus({ entry }: { entry: Entry }) {
  switch (entry.data.status) {
    case 'sending':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
          <span
            className="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-600 border-t-transparent"
            aria-hidden
          />
          发送中…
        </span>
      )
    case 'failed':
      return <span className="text-[11px] text-red-400">发送失败</span>
    default:
      return <span className="text-[11px] text-neutral-600">{fullDate.format(entry.createdAt)}</span>
  }
}

export const UserBubble = memo(function UserBubble({
  entry,
  loadBytes,
  onReply,
}: {
  entry: Entry
  loadBytes: (botId: string, id: string) => Promise<Uint8Array>
  onReply?: (e: Entry) => void
}) {
  const text = typeof entry.data.text === 'string' ? entry.data.text : ''
  return (
    <div className="group flex flex-col items-end gap-1" title={fullDate.format(entry.createdAt)}>
      {entry.data.attachments?.length ? (
        <div className="max-w-[80%]">
          <AttachmentList attachments={entry.data.attachments} botId={entry.botId} loadBytes={loadBytes} />
        </div>
      ) : null}
      {text || entry.data.replyTo ? (
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-neutral-700 px-3.5 py-2 text-sm text-neutral-100">
          {entry.data.replyTo ? <QuoteRow quote={entry.data.replyTo} /> : null}
          <div className="select-text whitespace-pre-wrap break-words">{text}</div>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <UserStatus entry={entry} />
        {onReply && <ReplyButton onClick={() => onReply(entry)} />}
      </div>
    </div>
  )
})

function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover:opacity-100"
      aria-label="回复这条消息"
    >
      回复
    </button>
  )
}

/** Artifact 卡（Phase 2）：标题 + 更新时间 + 下载；字节经 loadArtifact 分块读回（store/library.ts）。 */
function ArtifactCardView({
  botId,
  card,
  loadArtifact,
}: {
  botId: string
  card: { id: string; title: string; updatedAt?: number }
  loadArtifact: (botId: string, artifactId: string) => Promise<Uint8Array>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const bytes = await loadArtifact(botId, card.id)
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = card.title || 'artifact'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/70 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-base">
          📦
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">{card.title || 'Artifact'}</span>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-neutral-800 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? '读取中…' : '下载'}
        </button>
      </div>
      <p className="mt-0.5 text-[10px] text-neutral-500">
        {card.updatedAt ? `${fullDate.format(card.updatedAt)} · ` : ''}Bot 发布的工件
        {error ? ` · 下载失败：${error}` : ''}
      </p>
    </div>
  )
}

export const AgentBubble = memo(function AgentBubble({
  entry,
  loadSharedFile,
  loadArtifact,
  onReply,
}: {
  entry: Entry
  loadSharedFile: (entryId: string, id: string) => Promise<Uint8Array>
  loadArtifact?: (botId: string, artifactId: string) => Promise<Uint8Array>
  onReply?: (e: Entry) => void
}) {
  const text = typeof entry.data.text === 'string' ? entry.data.text : ''
  return (
    <div className="group flex flex-col items-start gap-1" title={fullDate.format(entry.createdAt)}>
      {entry.data.artifact ? (
        loadArtifact ? (
          <ArtifactCardView botId={entry.botId} card={entry.data.artifact} loadArtifact={loadArtifact} />
        ) : (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900/70 px-3.5 py-2.5 text-xs text-neutral-200">
            📦 {entry.data.artifact.title || 'Artifact'}
          </div>
        )
      ) : entry.data.files?.length ? (
        <SharedFileList files={entry.data.files} entryId={entry.id} loadBytes={loadSharedFile} />
      ) : (
        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-neutral-800 px-3.5 py-2">
          {entry.data.replyTo ? <QuoteRow quote={entry.data.replyTo} /> : null}
          <MarkdownText text={text} />
        </div>
      )}
      {onReply && <ReplyButton onClick={() => onReply(entry)} />}
    </div>
  )
})

/** notice 行：居中细字，error 样式红字（桌面端 NoticeRow 子集；语音通话行 Phase 3）。 */
export function NoticeRow({ entry }: { entry: Entry }) {
  const text = entry.data.text ?? ''
  if (entry.data.style === 'error')
    return (
      <div className="mx-auto flex max-w-[90%] items-start gap-1.5" role="alert">
        <span aria-hidden className="text-red-400">
          ⚠
        </span>
        <span className="select-text text-xs leading-relaxed text-red-300">{text}</span>
      </div>
    )
  return <div className="mx-auto max-w-[90%] truncate text-center text-xs text-neutral-500">{text}</div>
}
