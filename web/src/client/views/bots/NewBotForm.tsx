'use client'

/**
 * 新建 Bot 页（桌面端 NewBotView 的 Web 版）：预览 + 字段表单 → createBot → 跳转聊天。
 * I/O 在 store（appModel.admin.createBot），本组件持有表单态。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BotDraft } from '@codync/shared'
import { appModel } from '../../store/app-model'
import { useAppModel } from '../../use-app-model'
import { AvatarPreview, BotForm, draftOfFields, fieldsOfDraft, type BotFormFields } from './bot-form'
import { fillBackendDefault, newDraft } from './avatar-choices'

export function NewBotForm() {
  const router = useRouter()
  const snap = useAppModel()
  const [fields, setFields] = useState<BotFormFields>(() => ({
    ...fieldsOfDraft(newDraft()),
    backend: fillBackendDefault('claude', snap.hello?.backends ?? []),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backends = snap.hello?.backends ?? []
  const canCreate = !saving && snap.connection === 'open'

  const create = async () => {
    setSaving(true)
    setError(null)
    try {
      const draft: BotDraft = draftOfFields(fields, { name: '', description: '', avatarColor: '', avatarShape: '', backend: '', cwd: '', permission: 'ask' })
      const bot = await appModel.admin.createBot(draft)
      appModel.select(bot.id)
      router.replace('/client/chat')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h1 className="text-lg font-semibold text-neutral-100">新建 Bot</h1>
      <p className="mt-1 text-xs text-neutral-500">创建后出现在左侧花名册；默认主机个人工作区，agent 后端来自主机已装列表</p>

      <div className="mt-5 flex items-center gap-4">
        <AvatarPreview color={fields.avatarColor} shape={fields.avatarShape} size={56} />
        <p className="text-xs text-neutral-500">预览：所选形状与颜色的头像</p>
      </div>

      <div className="mt-4">
        <BotForm fields={fields} onChange={setFields} backends={backends} disabled={saving} />
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 rounded-xl bg-neutral-800 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={!canCreate}
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '创建中…' : '创建'}
        </button>
      </div>
      {snap.connection !== 'open' && <p className="mt-3 text-center text-xs text-neutral-500">需先连接主机（未连接时不能创建）</p>}
    </div>
  )
}
