/**
 * 工件库编排（Phase 2）：`library` 列表、`readArtifact` 分块读、`renameArtifact` 改名。
 * readArtifact 与 readUploadBytes 同款分块循环：每块上限 UPLOAD_CHUNK，安全封顶防死循环。
 */
import type { AppModel } from './app-model'
import { UPLOAD_CHUNK, fromBase64 } from '../transport/bytes'
import type { Artifact, LibraryItem } from '@codync/shared'

export async function fetchLibrary(appModel: AppModel, botId: string): Promise<LibraryItem[]> {
  if (appModel.getSnapshot().connection !== 'open') throw new Error('未连接主机')
  const { items } = await appModel.call<{ items: LibraryItem[] }>('library', { botId })
  return items
}

/** 分块读完整工件字节；返回拼接结果与最终 artifact 记录（主机每块都会带回最新元数据）。 */
export async function readArtifactBytes(
  appModel: AppModel,
  botId: string,
  artifactId: string,
): Promise<{ bytes: Uint8Array; artifact: Artifact }> {
  if (appModel.getSnapshot().connection !== 'open') throw new Error('未连接主机')
  const parts: Uint8Array[] = []
  let size = 0
  let artifact: Artifact | null = null
  // 安全封顶：MAX_FILE_SIZE(100MB) 内的块数，再多即视为主机异常。
  const maxChunks = Math.ceil((100 * 1024 * 1024) / UPLOAD_CHUNK) + 8
  for (;;) {
    const res = await appModel.call<{ data: string; size: number; artifact: Artifact }>('readArtifact', {
      botId,
      artifactId,
      offset: size,
    })
    artifact = res.artifact
    const chunk = fromBase64(res.data)
    if (!chunk.length) break
    parts.push(chunk)
    size += chunk.length
    if (size >= res.size) break
    if (parts.length > maxChunks) throw new Error('工件读取超过安全上限')
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  if (!artifact) throw new Error('主机未返回工件记录')
  return { bytes, artifact }
}

export async function renameArtifact(
  appModel: AppModel,
  botId: string,
  artifactId: string,
  title: string,
): Promise<Artifact> {
  if (appModel.getSnapshot().connection !== 'open') throw new Error('未连接主机')
  const { artifact } = await appModel.call<{ artifact: Artifact }>('renameArtifact', { botId, artifactId, title })
  return artifact
}
