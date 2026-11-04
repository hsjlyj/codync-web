'use client'

/**
 * 附件列表（桌面端 Attachments.tsx 的 Web 版）：图片内联缩略图（点击看大图），其他文件为卡片（点击下载）。
 * 字节来源由调用方注入（store 方法）：用户附件走 readUpload，Bot 分享文件走 readFile。
 */
import { useEffect, useRef, useState } from 'react'
import { isImageName, type Attachment, type SharedFile } from '@codync/shared'
import { byteCount } from '../../transport/bytes'

/** 文件图标的字符占位（Phase 1 不引图标库，用符号区分类型）。 */
export function attachmentSymbol(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'tiff', 'bmp'].includes(ext)) return '🖼'
  if (ext === 'pdf') return '📄'
  if (['zip', 'gz', 'tar', '7z'].includes(ext)) return '🗜'
  if (['mov', 'mp4', 'm4v'].includes(ext)) return '🎬'
  if (['mp3', 'm4a', 'wav', 'aac'].includes(ext)) return '🎵'
  return '📄'
}

/** 图片 20 MB 内内联预览（桌面端 showsAsImage 同值）。 */
const INLINE_IMAGE_MAX = 20 * 1024 * 1024

function triggerDownload(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 图片（对象 URL 懒加载 + 点击放大；卸载时回收 URL）。 */
function AttachmentImage({ name, load, size }: { name: string; size: number; load: () => Promise<Uint8Array> }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)
  const revoked = useRef(false)
  useEffect(() => {
    revoked.current = false
    load()
      .then((bytes) => {
        if (revoked.current) return
        setUrl(URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer])))
      })
      .catch(() => {
        if (!revoked.current) setFailed(true)
      })
    return () => {
      revoked.current = true
      setUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return null
      })
    }
    // 附件 id 即字节地址；load 闭包随 id 变化重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  if (failed)
    return (
      <div className="flex h-24 w-36 items-center justify-center rounded-lg bg-neutral-900 text-xs text-neutral-600">
        图片加载失败
      </div>
    )
  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label={`查看图片 ${name}`}
        className="overflow-hidden rounded-lg border border-neutral-800"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="max-h-48 max-w-[16rem] object-cover" />
        ) : (
          <div className="flex h-24 w-36 items-center justify-center bg-neutral-900 text-neutral-600">…</div>
        )}
      </button>
      {zoom && url && (
        <div
          role="dialog"
          aria-label={`图片 ${name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
          <p className="absolute bottom-4 text-xs text-neutral-400">
            {name} · {byteCount(size)}（点击任意处关闭）
          </p>
        </div>
      )}
    </>
  )
}

function FileCard({ name, size, load }: { name: string; size: number; load: () => Promise<Uint8Array> }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      triggerDownload(await load(), name)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      className="flex max-w-xs items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 text-left hover:border-neutral-700 disabled:opacity-50"
    >
      <span aria-hidden>{attachmentSymbol(name)}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-neutral-200">{name}</span>
        <span className="block text-[10px] text-neutral-500">{busy ? '下载中…' : `${byteCount(size)} · 点击下载`}</span>
      </span>
    </button>
  )
}

/** 用户消息的附件（upload id 引用主机文件）；load 由调用方注入（store 的 readUploadBytes）。 */
export function AttachmentList({
  attachments,
  botId,
  loadBytes,
}: {
  attachments: Attachment[]
  botId: string
  loadBytes: (botId: string, id: string) => Promise<Uint8Array>
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {attachments.map((file) =>
        isImageName(file.name) && file.size <= INLINE_IMAGE_MAX ? (
          <AttachmentImage key={file.id} name={file.name} size={file.size} load={() => loadBytes(botId, file.id)} />
        ) : (
          <FileCard key={file.id} name={file.name} size={file.size} load={() => loadBytes(botId, file.id)} />
        ),
      )}
    </div>
  )
}

/** Bot 分享的文件（SharedFile，按 entryId+fileId 读取）。 */
export function SharedFileList({
  files,
  entryId,
  loadBytes,
}: {
  files: SharedFile[]
  entryId: string
  loadBytes: (entryId: string, id: string) => Promise<Uint8Array>
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {files.map((file) =>
        isImageName(file.name) && file.size <= INLINE_IMAGE_MAX ? (
          <AttachmentImage key={file.id} name={file.name} size={file.size} load={() => loadBytes(entryId, file.id)} />
        ) : (
          <FileCard key={file.id} name={file.name} size={file.size} load={() => loadBytes(entryId, file.id)} />
        ),
      )}
    </div>
  )
}
