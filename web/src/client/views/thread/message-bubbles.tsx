'use client'

/**
 * 消息气泡（桌面端 ChatRows.tsx 的 Web 子集，Phase 1）：
 * user（右对齐，附件+引用+状态）、agent（左对齐，Markdown/文件/artifact 卡）、notice（居中细行，error 样式）。
 * 群聊作者标签、表情回应、右键菜单属 Phase 2（桌面端 ReactionsRow/AnchoredMenu 对应物）。
 */
import { memo } from 'react'
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

function ArtifactCardPlaceholder({ botId, title }: { botId: string; title: string }) {
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/70 px-3.5 py-2.5">
      <p className="text-xs font-medium text-neutral-200">{title || 'Artifact'}</p>
      <p className="mt-0.5 text-[10px] text-neutral-500">Bot {botId} 发布的工件 · 浏览器内查看将在 Phase 2 支持</p>
    </div>
  )
}

export const AgentBubble = memo(function AgentBubble({
  entry,
  loadSharedFile,
  onReply,
}: {
  entry: Entry
  loadSharedFile: (entryId: string, id: string) => Promise<Uint8Array>
  onReply?: (e: Entry) => void
}) {
  const text = typeof entry.data.text === 'string' ? entry.data.text : ''
  return (
    <div className="group flex flex-col items-start gap-1" title={fullDate.format(entry.createdAt)}>
      {entry.data.artifact ? (
        <ArtifactCardPlaceholder botId={entry.botId} title={entry.data.artifact.title ?? ''} />
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
