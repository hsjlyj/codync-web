'use client'

/**
 * Bot 花名册（Phase 2）：按 section 分组展示（roster-groups 纯函数），
 * HTML5 拖拽排序（drop 到行 = reorderBots）与拖拽分组（drop 到 section 头 = updateBot.section）。
 * I/O 经 onReorder/onMoveToSection 回调由页面编排，本组件只持拖拽状态。
 */
import { useState } from 'react'
import Link from 'next/link'
import type { Bot } from '@codync/shared'
import { rosterGroups } from './roster-groups'

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-neutral-500',
  working: 'bg-emerald-400 animate-pulse',
  needsInput: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400',
}

/** 按 pending 顺序展示（隐藏 Bot 不在 ids 里，保持相对顺序追加）。 */
const orderBotsBy = (bots: Bot[], ids: string[]): Bot[] => {
  const byId = new Map(bots.map((b) => [b.id, b]))
  const listed = ids.map((id) => byId.get(id)).filter((b): b is Bot => !!b)
  const rest = bots.filter((b) => !ids.includes(b.id))
  return [...listed, ...rest]
}

export function BotRoster({
  bots,
  selectedBotId,
  onSelect,
  onReorder,
  onMoveToSection,
}: {
  bots: Bot[]
  selectedBotId: string | null
  onSelect: (botId: string) => void
  onReorder: (ids: string[]) => void
  onMoveToSection: (bot: Bot, section: string | null) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  // 拖放后、主机 bot 事件回声前的本地顺序（bots prop 一变即清，避免与主机态长期分叉）。
  const [pending, setPending] = useState<string[] | null>(null)
  const idsKey = bots.map((b) => b.id).join('\n')
  const [lastIdsKey, setLastIdsKey] = useState(idsKey)
  if (lastIdsKey !== idsKey) {
    setLastIdsKey(idsKey)
    setPending(null)
  }

  const groups = rosterGroups(pending ? orderBotsBy(bots, pending) : bots)
  const visibleIds = groups.flatMap((g) => g.bots.map((b) => b.id))

  const dropOnRow = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    const ids = visibleIds.filter((id) => id !== draggedId)
    const at = ids.indexOf(targetId)
    ids.splice(at < 0 ? ids.length : at, 0, draggedId)
    setPending(ids)
    onReorder(ids)
  }

  const dropOnSection = (section: string | null) => {
    const bot = bots.find((b) => b.id === draggedId)
    if (!bot || (bot.section ?? null) === section) return
    onMoveToSection(bot, section)
  }

  if (bots.length === 0)
    return <p className="p-4 text-sm text-neutral-500">连接主机后，Bot 列表会随事件流出现在这里。</p>

  return (
    <ul className="flex-1 overflow-y-auto pb-2" aria-label="Bot 列表">
      {groups.map((group) => (
        <li key={group.section ?? '__ungrouped'}>
          {group.label ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOnSection(group.section)}
              className={`mt-2 flex items-center gap-2 px-4 py-1 text-[10px] font-medium uppercase tracking-wider ${
                draggedId ? 'border border-dashed border-neutral-600 text-neutral-300' : 'text-neutral-500'
              }`}
              aria-label={`分组 ${group.label}（可拖入 Bot）`}
            >
              {group.label}
            </div>
          ) : null}
          <ul>
            {group.bots.map((bot) => (
              <li key={bot.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onSelect(bot.id)}
                  aria-current={bot.id === selectedBotId}
                  draggable
                  onDragStart={() => setDraggedId(bot.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOnRow(bot.id)}
                  className={`flex min-w-0 flex-1 cursor-grab items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-800/60 ${
                    bot.id === selectedBotId ? 'bg-neutral-800 text-white' : 'text-neutral-300'
                  }`}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: bot.avatarColor || '#525252' }}
                    aria-hidden
                  >
                    {bot.name.slice(0, 1) || '?'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {bot.name}
                      {(bot.pinned || bot.lead) && (
                        <span className="ml-1.5 align-middle text-[10px] text-amber-300" aria-label="置顶">
                          ★
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">{bot.backend}</span>
                  </span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[bot.status] ?? 'bg-neutral-600'}`}
                    aria-label={bot.status}
                  />
                </button>
                <Link
                  href={`/client/bots/edit?bot=${encodeURIComponent(bot.id)}`}
                  aria-label={`编辑 ${bot.name}`}
                  className="shrink-0 px-2 py-2 text-xs text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ✎
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
