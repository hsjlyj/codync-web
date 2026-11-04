'use client'

import type { Bot } from '@codync/shared'

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-neutral-500',
  working: 'bg-emerald-400 animate-pulse',
  needsInput: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400',
}

export function BotRoster({
  bots,
  selectedBotId,
  onSelect,
}: {
  bots: Bot[]
  selectedBotId: string | null
  onSelect: (botId: string) => void
}) {
  if (bots.length === 0)
    return <p className="p-4 text-sm text-neutral-500">连接主机后，Bot 列表会随事件流出现在这里。</p>
  return (
    <ul className="flex-1 overflow-y-auto" aria-label="Bot 列表">
      {bots.map((bot) => (
        <li key={bot.id}>
          <button
            type="button"
            onClick={() => onSelect(bot.id)}
            aria-current={bot.id === selectedBotId}
            className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-800/60 ${
              bot.id === selectedBotId ? 'bg-neutral-800 text-white' : 'text-neutral-300'
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: bot.avatarColor || '#525252' }}
              aria-hidden
            >
              {bot.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{bot.name}</span>
              <span className="block truncate text-xs text-neutral-500">{bot.backend}</span>
            </span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[bot.status] ?? 'bg-neutral-600'}`}
              aria-label={bot.status}
            />
          </button>
        </li>
      ))}
    </ul>
  )
}
