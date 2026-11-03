'use client'

import type { ConnectionState } from '../store/app-model'

const LABELS: Record<ConnectionState, { text: string; dot: string }> = {
  idle: { text: '未连接', dot: 'bg-neutral-500' },
  connecting: { text: '连接中…', dot: 'bg-amber-400 animate-pulse' },
  handshaking: { text: '握手中…', dot: 'bg-amber-400 animate-pulse' },
  open: { text: '已连接', dot: 'bg-emerald-400' },
  reconnecting: { text: '重连中…', dot: 'bg-amber-400 animate-pulse' },
  closed: { text: '已断开', dot: 'bg-neutral-500' },
  failed: { text: '连接失败', dot: 'bg-red-400' },
}

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  const label = LABELS[connection]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">
      <span className={`h-1.5 w-1.5 rounded-full ${label.dot}`} aria-hidden />
      {label.text}
    </span>
  )
}
