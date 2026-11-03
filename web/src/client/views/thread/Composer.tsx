'use client'

import { useState } from 'react'

export function Composer({
  disabled,
  pending,
  onSend,
}: {
  disabled: boolean
  pending: boolean
  onSend: (text: string) => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || pending) return
    try {
      await onSend(trimmed)
      setText('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="border-t border-neutral-800 p-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={2}
          disabled={disabled}
          placeholder={disabled ? '选择一个 Bot 后可以发消息' : '输入消息，Enter 发送，Shift+Enter 换行'}
          aria-label="消息输入框"
          className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || pending || !text.trim()}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? '发送中…' : '发送'}
        </button>
      </div>
      {error && <p className="mx-auto mt-2 max-w-3xl text-xs text-red-400">{error}</p>}
      <p className="mx-auto mt-1.5 max-w-3xl text-right text-[11px] text-neutral-600">文件上传（Phase 1）· 语音（Phase 3）</p>
    </div>
  )
}
