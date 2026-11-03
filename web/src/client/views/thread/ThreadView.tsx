'use client'

import { useEffect, useRef } from 'react'
import type { Entry } from '@codync/shared'
import { isChat } from '@codync/shared'

/** 聊天可见性按主机契约：user/permission 全显，agent 仅 final，notice 过滤记忆类。 */
const visible = (entry: Entry) => {
  if (!isChat(entry)) return false
  if (entry.kind === 'agent') return entry.data.final === true
  return true
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === 'user') {
    const text = typeof entry.data.text === 'string' ? entry.data.text : ''
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-neutral-700 px-4 py-2 text-sm text-neutral-100">
          {text}
        </div>
      </div>
    )
  }
  if (entry.kind === 'agent') {
    const text = typeof entry.data.text === 'string' ? entry.data.text : ''
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-neutral-800 px-4 py-2 text-sm text-neutral-100">
          {text}
        </div>
      </div>
    )
  }
  if (entry.kind === 'permission') {
    return (
      <div className="mx-auto max-w-[90%] rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
        权限请求（Phase 1 支持回应）：{JSON.stringify(entry.data)}
      </div>
    )
  }
  const text = typeof entry.data.text === 'string' ? entry.data.text : JSON.stringify(entry.data)
  return <div className="mx-auto max-w-[90%] truncate font-mono text-xs text-neutral-500">{`· ${text}`}</div>
}

export function ThreadView({ entries, botName }: { entries: Entry[]; botName: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const chat = entries.filter(visible)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.length])

  if (!botName)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        从左侧选择一个 Bot 开始对话
      </div>
    )
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6" aria-label={`${botName} 的对话`}>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {chat.length === 0 && <p className="text-center text-sm text-neutral-600">暂无消息记录</p>}
        {chat.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
