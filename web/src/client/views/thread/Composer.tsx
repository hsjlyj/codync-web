'use client'

/**
 * 消息输入区（Phase 1）：文本 + 附件（选择/拖拽/粘贴）+ 回复引用预览 + 上传进度。
 * 文件字节不在此读：pickedFiles 只做元信息整理，上传由 AppModel.uploadFiles 完成。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Entry } from '@codync/shared'
import { byteCount } from '../../transport/bytes'
import { QuoteRow } from './message-bubbles'
import { attachmentSymbol } from './attachment-list'
import { pickedFiles, type PickedFile } from './composer-files'
import { browserRecognizerFactory, createSpeechInput, speechSupported, type SpeechInput } from './speech-input'

// 语音能力在会话内不会变化：无需真实订阅源（useSyncExternalStore 仅借其 SSR/CSR 双快照）。
const subscribeNever = () => () => {}

export function Composer({
  disabled,
  pending,
  reply,
  cancelReply,
  onSend,
}: {
  disabled: boolean
  pending: boolean
  reply: Entry | null
  cancelReply: () => void
  onSend: (
    text: string,
    files: File[],
    replyTo: string | null,
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  // 语音输入（Phase 3，浏览器本地 Web Speech API）：能力探测用 useSyncExternalStore
  // （SSR 快照恒 false → 按钮水合后一致地隐藏/显示，且不触发 effect 级联渲染）。
  const speechReady = useSyncExternalStore(subscribeNever, speechSupported, () => false)
  const [listening, setListening] = useState(false)
  const speechRef = useRef<SpeechInput | null>(null)
  const speechBaseRef = useRef('')
  const speechFinalRef = useRef('')
  useEffect(() => speechRef.current?.stop(), [])

  const toggleSpeech = () => {
    if (listening) {
      speechRef.current?.stop()
      return
    }
    const factory = browserRecognizerFactory()
    if (!factory) return
    speechBaseRef.current = text
    speechFinalRef.current = ''
    speechRef.current = createSpeechInput(
      factory,
      {
        onFinal: (chunk) => {
          speechFinalRef.current += chunk
          setText(speechBaseRef.current + speechFinalRef.current)
        },
        onInterim: (interim) => setText(speechBaseRef.current + speechFinalRef.current + interim),
        onError: (message) => setError(message),
        onEnd: () => {
          speechRef.current = null
          setListening(false)
        },
      },
      typeof navigator !== 'undefined' ? navigator.language || 'zh-CN' : 'zh-CN',
    )
    speechRef.current.start()
    setListening(true)
  }

  // 选了回复对象：焦点进输入框（桌面端同行为）。
  useEffect(() => {
    if (reply) fieldRef.current?.focus()
  }, [reply])

  const addFiles = (incoming: FileList | File[]) => {
    const { picked, rejected } = pickedFiles(files, incoming)
    setFiles(picked)
    if (rejected.length) setError(rejected.join('；'))
    else setError(null)
  }

  const submit = async () => {
    const trimmed = text.trim()
    if ((!trimmed && files.length === 0) || disabled || pending) return
    try {
      setError(null)
      const chosen = files.map((f) => f.file)
      const replyTo = reply?.id ?? null
      setFiles([])
      setText('')
      // 发送后清空语音会话基线：后续转写从空输入追加，不叠回已发送文本。
      speechBaseRef.current = ''
      speechFinalRef.current = ''
      await onSend(trimmed || '（附件）', chosen, replyTo, (done, total) =>
        setUploadStage(total > 1 ? `上传中 ${done}/${total}` : done < total ? '上传中…' : null),
      )
      setUploadStage(null)
      if (replyTo) cancelReply()
    } catch (e) {
      setUploadStage(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="border-t border-neutral-800 p-3"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
      }}
    >
      {reply && (
        <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg bg-neutral-800/50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <QuoteRow
              quote={{
                id: reply.id,
                author: 'user',
                text: (typeof reply.data.text === 'string' ? reply.data.text : '').slice(0, 200),
              }}
            />
          </div>
          <button
            type="button"
            onClick={cancelReply}
            aria-label="取消回复"
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
          {files.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/70 px-2 py-1 text-xs text-neutral-300"
            >
              <span aria-hidden>{attachmentSymbol(f.file.name)}</span>
              <span className="max-w-[12rem] truncate">{f.file.name}</span>
              <span className="text-neutral-600">{byteCount(f.file.size)}</span>
              <button
                type="button"
                aria-label={`移除附件 ${f.file.name}`}
                onClick={() => setFiles((current) => current.filter((p) => p.id !== f.id))}
                className="text-neutral-600 hover:text-neutral-300"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
          aria-label="选择附件文件"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-label="添加附件"
          title="添加附件（也可拖入或粘贴）"
          className="shrink-0 rounded-xl border border-neutral-700 px-3 py-2.5 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-40"
        >
          📎
        </button>
        <textarea
          ref={fieldRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault()
              addFiles(e.clipboardData.files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={2}
          disabled={disabled}
          placeholder={
            disabled
              ? '选择一个 Bot 后可以发消息'
              : reply
                ? '回复…（Enter 发送，Shift+Enter 换行）'
                : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          aria-label="消息输入框"
          className={`flex-1 resize-none rounded-xl border bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-50 ${
            dragOver ? 'border-emerald-500' : 'border-neutral-700'
          }`}
        />
        {speechReady && (
          <button
            type="button"
            onClick={toggleSpeech}
            disabled={disabled}
            aria-label={listening ? '停止语音输入' : '开始语音输入'}
            aria-pressed={listening}
            title={listening ? '停止语音输入' : '语音输入（浏览器本地识别）'}
            className={`shrink-0 rounded-xl border px-3 py-2.5 text-sm disabled:opacity-40 ${
              listening
                ? 'animate-pulse border-red-500 bg-red-500/10 text-red-400'
                : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
            }`}
          >
            🎤
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || pending || (!text.trim() && files.length === 0)}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending || uploadStage ? '发送中…' : '发送'}
        </button>
      </div>
      {listening && (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-red-400" aria-live="polite">
          语音识别中，请说话…（说完点麦克风停止）
        </p>
      )}
      {uploadStage && <p className="mx-auto mt-2 max-w-3xl text-xs text-neutral-400">{uploadStage}</p>}
      {error && (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
