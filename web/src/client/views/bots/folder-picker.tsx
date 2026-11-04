'use client'

/**
 * 文件夹选择器：主机 `listDirs` 逐级浏览（面包屑 + 子目录 + 最近工作区），选定路径回填表单。
 * I/O 经 appModel.admin.listDirs，本组件只持有导航状态。
 */
import { useEffect, useState } from 'react'
import type { DirListing } from '@codync/shared'
import { appModel } from '../../store/app-model'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function FolderPicker({ value, onPick, onClose }: { value: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 首载：setState 全在 promise 回调里（effect 体内不做同步 setState）。
  useEffect(() => {
    let alive = true
    appModel.admin
      .listDirs()
      .then((l) => {
        if (alive) setListing(l)
      })
      .catch((e: unknown) => {
        if (alive) setError(messageOf(e))
      })
    return () => {
      alive = false
    }
  }, [])

  // 用户点击导航（事件回调里同步 setState 没问题）。
  const browse = (path?: string) => {
    setLoading(true)
    setError(null)
    appModel.admin
      .listDirs(path)
      .then((l) => setListing(l))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setLoading(false))
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-950 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-300">{listing?.path ?? '…'}</span>
        <button type="button" onClick={onClose} aria-label="关闭目录选择" className="text-xs text-neutral-500 hover:text-neutral-300">
          ✕
        </button>
      </div>
      {listing?.ancestors?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
          <button type="button" onClick={() => browse('')} className="hover:text-neutral-300">
            根目录
          </button>
          {listing.ancestors.map((a) => (
            <span key={a.path} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <button type="button" onClick={() => browse(a.path)} className="hover:text-neutral-300">
                {a.name}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 max-h-56 overflow-y-auto">
        {(loading || (listing === null && !error)) && <p className="px-1 py-2 text-xs text-neutral-500">读取中…</p>}
        {!loading && listing?.recent?.length ? (
          <div className="mb-2">
            <p className="px-1 py-1 text-[10px] uppercase tracking-wider text-neutral-600">最近使用</p>
            {listing.recent.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => onPick(r.path)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              >
                {r.path}
              </button>
            ))}
          </div>
        ) : null}
        {!loading &&
          listing?.dirs.map((d) => (
            <button
              key={d.path}
              type="button"
              onClick={() => browse(d.path)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <span aria-hidden className="text-neutral-500">
                ▸
              </span>
              <span className="min-w-0 truncate">{d.name}</span>
              {d.isGit && <span className="ml-auto shrink-0 text-[10px] text-neutral-600">git</span>}
            </button>
          ))}
        {!loading && listing && listing.dirs.length === 0 && (
          <p className="px-1 py-2 text-xs text-neutral-600">此目录下没有子目录</p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-2">
        <span className="min-w-0 truncate text-xs text-neutral-500">当前值：{value || '（空 = 主机个人工作区）'}</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onPick('')}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            用个人工作区
          </button>
          <button
            type="button"
            onClick={() => onPick(listing?.path ?? value)}
            disabled={!listing}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            选定此目录
          </button>
        </div>
      </div>
    </div>
  )
}
