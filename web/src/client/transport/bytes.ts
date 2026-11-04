/**
 * 标准 base64 编解码（RFC 4648，带填充）——文件上传/下载分块用。
 * 与 channel-crypto.ts 的 base64url 无填充（握手/帧封套）是两套字母表：
 * 主机 `upload`/`readUpload` 用 base64::engine::general_purpose::STANDARD（api/bots.rs:127）。
 */

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** 每次 `upload` 调用的字节数：base64 后远小于通道 1 MiB 帧上限（桌面端同值，host-client.ts:203）。 */
export const UPLOAD_CHUNK = 384 * 1024

/** 文件分块：`[起始字节, 结束字节)` 序列，收尾块对齐文件末尾（空文件为空序列）。 */
export function chunkRanges(size: number, chunkSize = UPLOAD_CHUNK): Array<[number, number]> {
  if (size <= 0) return []
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < size; start += chunkSize) {
    ranges.push([start, Math.min(start + chunkSize, size)])
  }
  return ranges
}

/** 主机单文件上限 100 MB（host/src/chat/uploads.rs MAX_FILE）。 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024

/** 人类可读的文件大小（桌面端 byteCount 同款舍入口径）。 */
export function byteCount(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
