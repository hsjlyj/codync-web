/**
 * 工件库编排测试（Phase 2）：library 列表、readArtifact 分块循环组装（mock 1KB/块）、
 * renameArtifact 回传新记录。主机方法事实见砚台 06c8e3c（api-types §5 P2 标注）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/mock-transport'
import { AppModel } from './app-model'
import { fetchLibrary, readArtifactBytes, renameArtifact } from './library'

describe('library 编排（MockTransport）', () => {
  let model: AppModel

  beforeEach(async () => {
    model = new AppModel()
    await model.connect(new MockTransport())
  })

  it('fetchLibrary 返回工件项；readArtifactBytes 分块拼出完整内容', async () => {
    const items = await fetchLibrary(model, 'bot-claude')
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item?.kind).toBe('artifact')
    if (item?.kind !== 'artifact') return
    expect(item.artifact.title).toBe('演示报告.md')

    const { bytes, artifact } = await readArtifactBytes(model, 'bot-claude', item.artifact.id)
    expect(artifact.id).toBe(item.artifact.id)
    expect(bytes.length).toBe(artifact.size)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('第 1 行')
    expect(text).toContain('第 80 行')
  })

  it('readArtifactBytes 对未知工件抛错', async () => {
    await expect(readArtifactBytes(model, 'bot-claude', 'nope')).rejects.toThrow()
  })

  it('renameArtifact 返回改名后的记录', async () => {
    const items = await fetchLibrary(model, 'bot-claude')
    const artifact = items[0]?.kind === 'artifact' ? items[0].artifact : null
    if (!artifact) return
    const renamed = await renameArtifact(model, 'bot-claude', artifact.id, '新名字.md')
    expect(renamed.title).toBe('新名字.md')
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(artifact.updatedAt)
  })
})
