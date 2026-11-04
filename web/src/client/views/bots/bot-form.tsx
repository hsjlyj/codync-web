'use client'

/**
 * Bot 表单（新建/编辑共用，桌面端 NewBotView+BotEditorView 的 Web 收敛版）：
 * name/description/avatar（形状+颜色）/backend（主机已装后端）/cwd（listDirs 选择）/
 * permission(ask|auto)/model/section。字段与砚台的 BotDraft 一一对应；
 * 高级项（fallbacks/connectors/skills/computer 等）Phase 2 暂以只读留白，后续补充。
 */
import { useState } from 'react'
import type { BotDraft } from '@codync/shared'
import { AVATAR_COLORS, AVATAR_SHAPES, avatarHex } from './avatar-choices'
import { FolderPicker } from './folder-picker'

export interface BotFormFields {
  name: string
  description: string
  avatarColor: string
  avatarShape: string
  backend: string
  command: string
  cwd: string
  permission: string
  model: string
  section: string
}

export const fieldsOfDraft = (draft: BotDraft): BotFormFields => ({
  name: draft.name,
  description: draft.description,
  avatarColor: draft.avatarColor,
  avatarShape: draft.avatarShape,
  backend: draft.backend,
  command: draft.command ?? '',
  cwd: draft.cwd,
  permission: draft.permission,
  model: draft.model ?? '',
  section: draft.section ?? '',
})

/** 表单 → BotDraft（空串字段归 null：主机收到 null 会清掉，桌面端同语义）。 */
export const draftOfFields = (f: BotFormFields, base: BotDraft): BotDraft => ({
  ...base,
  name: f.name.trim(),
  description: f.description.trim(),
  avatarColor: f.avatarColor,
  avatarShape: f.avatarShape,
  backend: f.backend,
  command: f.backend === 'custom' ? f.command || null : null,
  cwd: f.cwd,
  permission: f.permission,
  model: f.model.trim() || null,
  section: f.section.trim() || null,
})

export function BotForm({
  fields,
  onChange,
  backends,
  disabled,
}: {
  fields: BotFormFields
  onChange: (next: BotFormFields) => void
  backends: Array<{ id: string; name: string; available: boolean; curated?: boolean }>
  disabled?: boolean
}) {
  const [pickingFolder, setPickingFolder] = useState(false)
  const set = (patch: Partial<BotFormFields>) => onChange({ ...fields, ...patch })
  const isCustom = fields.backend === 'custom'

  return (
    <div className="flex flex-col gap-4">
      <Field label="名称（留空则由主机在首次对话后命名）">
        <input value={fields.name} onChange={(e) => set({ name: e.target.value })} disabled={disabled} className={inputClass} placeholder="给这个 Bot 起个名字" />
      </Field>

      <Field label="描述">
        <input value={fields.description} onChange={(e) => set({ description: e.target.value })} disabled={disabled} className={inputClass} placeholder="它做什么（可选）" />
      </Field>

      <div>
        <p className="mb-1.5 text-xs text-neutral-400">头像形状</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="头像形状">
          {AVATAR_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              role="radio"
              aria-checked={fields.avatarShape === shape}
              onClick={() => set({ avatarShape: shape })}
              disabled={disabled}
              className={`rounded-lg px-2.5 py-1 text-xs ${fields.avatarShape === shape ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800'}`}
            >
              {shape}
            </button>
          ))}
        </div>
        <p className="mt-2 mb-1.5 text-xs text-neutral-400">头像颜色</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="头像颜色">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={fields.avatarColor === c.id}
              aria-label={c.label}
              onClick={() => set({ avatarColor: c.id })}
              disabled={disabled}
              className={`h-7 w-7 rounded-full transition-transform ${fields.avatarColor === c.id ? 'scale-110 ring-2 ring-neutral-300 ring-offset-2 ring-offset-neutral-900' : 'opacity-70 hover:opacity-100'}`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      </div>

      <Field label="Agent 后端">
        <select value={fields.backend} onChange={(e) => set({ backend: e.target.value })} disabled={disabled} className={inputClass}>
          {backends.filter((b) => b.available).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name || b.id}
              {b.curated ? '' : '（未受管）'}
            </option>
          ))}
          <option value="custom">custom（自定义命令）</option>
        </select>
      </Field>

      {isCustom && (
        <Field label="启动命令（custom 后端）">
          <input value={fields.command} onChange={(e) => set({ command: e.target.value })} disabled={disabled} className={inputClass} placeholder="例如：npx some-acp-agent" />
        </Field>
      )}

      <Field label="工作目录（空 = 主机个人工作区）">
        <div className="flex gap-2">
          <input value={fields.cwd} onChange={(e) => set({ cwd: e.target.value })} disabled={disabled} className={inputClass} placeholder="~/projects/demo" />
          <button
            type="button"
            onClick={() => setPickingFolder((p) => !p)}
            disabled={disabled}
            className="shrink-0 rounded-lg bg-neutral-800 px-3 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            浏览
          </button>
        </div>
        {pickingFolder && (
          <div className="mt-2">
            <FolderPicker value={fields.cwd} onPick={(path) => { set({ cwd: path }); setPickingFolder(false) }} onClose={() => setPickingFolder(false)} />
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="权限模式">
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="权限模式">
            {[
              { id: 'ask', label: '每次询问' },
              { id: 'auto', label: '自动（agent 自判）' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={fields.permission === p.id}
                onClick={() => set({ permission: p.id })}
                disabled={disabled}
                className={`rounded-lg px-2 py-1.5 text-xs ${fields.permission === p.id ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="分组（section，留空不分组）">
          <input value={fields.section} onChange={(e) => set({ section: e.target.value })} disabled={disabled} className={inputClass} placeholder="Work / Personal…" />
        </Field>
      </div>

      <Field label="模型（留空用 agent 默认）">
        <input value={fields.model} onChange={(e) => set({ model: e.target.value })} disabled={disabled} className={inputClass} placeholder="例如：claude-sonnet-4-5" />
      </Field>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

// 预览头像用（表单头部显示当前形状+颜色的实际效果）。
export function AvatarPreview({ color, shape, size = 64 }: { color: string; shape: string; size?: number }) {
  const radii: Record<string, string> = {
    blob: '45% 55% 60% 40% / 50% 45% 55% 50%',
    pebble: '60% 40% 55% 45% / 45% 60% 40% 55%',
    squircle: '30%',
    tablet: '12%',
    wedge: '18% 55% 18% 55%',
    hex: '20% 65% 20% 65% / 55% 20% 65% 20%',
    cloud: '50% 50% 35% 65% / 60% 40% 60% 40%',
    teardrop: '50% 50% 50% 15% / 50% 50% 50% 15%',
  }
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{ width: size, height: size, backgroundColor: avatarHex(color), borderRadius: radii[shape] ?? '30%' }}
    />
  )
}
