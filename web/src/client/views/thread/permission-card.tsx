'use client'

/**
 * 权限审批卡片（桌面端 PermissionCard.tsx 的 Web 版）：agent 想做什么、在哪运行、明细（命令/diff）、选项按钮。
 * 选项排序与文案同桌面端：allow 在 reject 前、once 在 always 前；回答中按钮锁定转圈。
 */
import { useState } from 'react'
import type { Entry, FileDiff, PermissionOption } from '@codync/shared'

/** agent 想做什么（卡片标题），按工具类别。 */
export const permissionHeadline = (toolKind?: string) => {
  switch (toolKind) {
    case 'execute':
      return '想执行一条命令'
    case 'edit':
    case 'delete':
    case 'move':
      return '想修改文件'
    case 'fetch':
      return '想访问网络'
    case 'read':
    case 'search':
      return '想读取文件'
    default:
      return '想使用一个工具'
  }
}

const rank: Record<string, number> = { allow_once: 0, allow_always: 1, reject_once: 2, reject_always: 3 }

/** Allow before deny, once before always. */
export const sortedOptions = (options: PermissionOption[]) =>
  [...options].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))

export function optionLabel(o: PermissionOption) {
  switch (o.kind) {
    case 'allow_once':
      return '允许一次'
    case 'allow_always':
      return '总是允许'
    case 'reject_once':
      return '拒绝'
    case 'reject_always':
      return '永不'
    default:
      return o.name
  }
}

function outcome(entry: Entry) {
  const d = entry.data
  switch (d.status) {
    case 'answered': {
      const chosen = d.options?.find((o) => o.optionId === d.selected)
      switch (chosen?.kind) {
        case 'allow_once':
          return '已允许一次'
        case 'allow_always':
          return '已总是允许'
        case 'reject_once':
          return '已拒绝'
        case 'reject_always':
          return '已设为永不'
        default:
          return chosen?.name ?? '已回应'
      }
    }
    case 'cancelled':
      return '已取消'
    default:
      return '已过期 — agent 继续了下一步'
  }
}

export function CodeBox({ text }: { text: string }) {
  return (
    <pre className="max-h-48 select-text overflow-auto rounded-lg bg-neutral-950 p-2.5 font-mono text-xs leading-relaxed text-neutral-300">
      {text}
    </pre>
  )
}

function DiffView({ diff }: { diff: FileDiff }) {
  const lines = diff.patch.split('\n').slice(0, 80)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden>{diff.isNew ? '＋' : '≡'}</span>
        <span className="min-w-0 truncate text-neutral-300">{diff.path.split('/').pop()}</span>
        <span className="font-mono text-emerald-400">+{diff.added}</span>
        <span className="font-mono text-red-400">−{diff.removed}</span>
      </div>
      <div className="max-h-48 overflow-auto rounded-lg bg-neutral-950 p-2.5 font-mono text-xs leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith('+')
                ? 'bg-emerald-500/10 text-emerald-300'
                : line.startsWith('-')
                  ? 'bg-red-500/10 text-red-300'
                  : 'text-neutral-400'
            }
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PermissionCard({
  entry,
  hostName,
  answering,
  respond,
}: {
  entry: Entry
  hostName: string
  answering: string | null
  respond: (option: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const d = entry.data
  const pending = d.status === 'pending'
  const hasDetail = !!d.command || !!d.detail || !!d.diffs?.length
  const options = sortedOptions(d.options ?? [])
  const cwd = d.cwd ? ` · ${d.cwd.split('/').filter(Boolean).pop() ?? d.cwd}` : ''
  return (
    <div className="max-w-md rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-amber-100">{permissionHeadline(d.toolKind)}</h3>
        {pending && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" aria-label="等待回应" />}
      </div>
      <p className="mt-1.5 select-text break-all font-mono text-xs text-amber-200/90">{d.title ?? ''}</p>
      <p className="mt-1 text-[11px] text-neutral-500">
        运行于 {hostName}
        {cwd}
      </p>
      {hasDetail && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="text-[11px] font-medium text-neutral-400 hover:text-neutral-200"
          >
            {expanded ? '收起' : '展开'}明细
          </button>
          {expanded && (
            <div className="mt-2 flex flex-col gap-2">
              {d.command ? <CodeBox text={d.command} /> : null}
              {d.detail ? <CodeBox text={d.detail.slice(0, 2000)} /> : null}
              {(d.diffs ?? []).map((diff, i) => (
                <DiffView key={i} diff={diff} />
              ))}
            </div>
          )}
        </div>
      )}
      {pending ? (
        <div className="mt-3 divide-y divide-neutral-800" role="group" aria-label="权限选项">
          {options.map((o) => (
            <button
              key={o.optionId}
              type="button"
              disabled={answering !== null}
              onClick={() => respond(o.optionId)}
              className={`flex w-full items-center justify-between px-1 py-2 text-sm first:pt-1 last:pb-1 disabled:cursor-not-allowed ${
                answering !== null && answering !== o.optionId ? 'opacity-40' : ''
              } hover:opacity-100`}
            >
              <span className={o.kind.startsWith('allow') ? 'font-semibold text-neutral-100' : 'text-red-400'}>
                {optionLabel(o)}
              </span>
              {answering === o.optionId && (
                <span
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-600 border-t-transparent"
                  aria-label="回应中"
                />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-neutral-400">{outcome(entry)}</p>
      )}
    </div>
  )
}
