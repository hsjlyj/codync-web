/**
 * Composer 附件整理（纯函数，桌面端 composer-files.ts 同构）：FileList → 待上传列表。
 * 过滤超限（主机单文件 100 MB）与重复（name+size+lastModified），上限 10 个附件。
 */
import { MAX_FILE_SIZE } from '../../transport/bytes'

export interface PickedFile {
  id: string
  file: File
}

export const MAX_ATTACHMENTS = 10

export function pickedFiles(
  previous: PickedFile[],
  incoming: FileList | File[],
): { picked: PickedFile[]; rejected: string[] } {
  const seen = new Set(previous.map((p) => `${p.file.name}:${p.file.size}:${p.file.lastModified}`))
  const picked = [...previous]
  const rejected: string[] = []
  for (const file of incoming) {
    if (picked.length >= MAX_ATTACHMENTS) {
      rejected.push(`${file.name}（最多 ${MAX_ATTACHMENTS} 个附件）`)
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      rejected.push(`${file.name}（超过 100 MB）`)
      continue
    }
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ id: key, file })
  }
  return { picked, rejected }
}
