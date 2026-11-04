'use client'

/**
 * 编辑 Bot 页（桌面端 BotEditorView 的 Web 收敛版）：预填 draftOf(bot)，保存走 updateBot（id 必填）；
 * 删除带确认对话框（「删除」是软删，roster 由主机 deleted 事件收窄）。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { draftOf, type BotDraft } from '@codync/shared'
import { appModel } from '../../store/app-model'
import { useAppModel } from '../../use-app-model'
import { AvatarPreview, BotForm, draftOfFields, fieldsOfDraft, type BotFormFields } from './bot-form'
import { fillBackendDefault } from './avatar-choices'

export function BotEditor({ botId }: { botId: string }) {
  const router = useRouter()
  const snap = useAppModel()
  const bot = snap.bots.find((b) => b.id === botId) ?? null
  const [fields, setFields] = useState<BotFormFields | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!bot) {
    return (
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 text-center">
        <p className="text-sm text-neutral-400">找不到这个 Bot（可能已被删除）</p>
        <button type="button" onClick={() => router.replace('/client/chat')} className="mt-4 rounded-xl bg-neutral-800 px-4 py-2 text-xs text-neutral-300 hover:bg-neutral-700">
          回到聊天
        </button>
      </div>
    )
  }

  const current = fields ?? fieldsOfDraft(draftOf(bot))
  const backends = snap.hello?.backends ?? []
  const backendFilled = fields
    ? current
    : { ...current, backend: fillBackendDefault(current.backend, backends) }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const draft: BotDraft = draftOfFields(backendFilled, draftOf(bot))
      await appModel.admin.updateBot(draft)
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    setError(null)
    try {
      await appModel.admin.deleteBot(bot.id)
      appModel.select(null)
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h1 className="text-lg font-semibold text-neutral-100">编辑 {bot.name}</h1>
      <p className="mt-1 text-xs text-neutral-500">改动保存后经加密通道提交主机（updateBot），花名册由事件刷新</p>

      <div className="mt-5 flex items-center gap-4">
        <AvatarPreview color={backendFilled.avatarColor} shape={backendFilled.avatarShape} size={56} />
        <div className="min-w-0">
          <p className="truncate text-sm text-neutral-200">{bot.name}</p>
          <p className="text-xs text-neutral-500">
            {bot.backend} · {bot.cwd}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <BotForm fields={backendFilled} onChange={setFields} backends={backends} disabled={saving} />
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
          disabled={saving}
          className={`rounded-xl px-4 py-2.5 text-sm ${confirmDelete ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'} disabled:opacity-50`}
        >
          {confirmDelete ? '确认删除？' : '删除'}
        </button>
        {confirmDelete && (
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-700">
            取消
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
