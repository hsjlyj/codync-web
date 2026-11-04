/** 搜索过滤纯函数测试（Phase 2）：正文/附件名/工件标题、大小写不敏感、摘要边界、隐藏 Bot 跳过。 */
import { describe, expect, it } from 'vitest'
import type { Bot, Entry } from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import { searchLoadedEntries, snippetAround } from './search'

const botOf = (id: string, section?: string, hidden = false): Bot =>
  normalizeBot({ id, name: id, backend: 'claude', cwd: '', section, hidden })

const entryOf = (id: string, botId: string, data: Record<string, unknown>, updatedAt = 100): Entry => ({
  id,
  seq: 1,
  botId,
  rev: 1,
  kind: 'user',
  turn: 1,
  data,
  createdAt: updatedAt,
  updatedAt,
})

describe('snippetAround', () => {
  it('命中返回带省略号的摘要；未命中返回 null', () => {
    const text = 'a'.repeat(60) + 'needle' + 'b'.repeat(60)
    const snippet = snippetAround(text, 'needle')
    expect(snippet).toMatch(/^…a+needleb+…$/)
    expect(snippetAround('nothing here', 'needle')).toBeNull()
  })

  it('大小写不敏感', () => {
    expect(snippetAround('Deploy DONE today', 'deploy done')).not.toBeNull()
  })
})

describe('searchLoadedEntries', () => {
  const bots = [botOf('bot-a'), botOf('bot-b', 'Work'), botOf('bot-hidden', undefined, true)]
  const index = new Map<string, Entry[]>([
    ['bot-a', [entryOf('e1', 'bot-a', { text: 'please run the deploy script' })]],
    [
      'bot-b',
      [
        entryOf('e2', 'bot-b', { text: 'unrelated', attachments: [{ id: 'u1', name: 'report-final.pdf', size: 1 }] }),
        entryOf(
          'e3',
          'bot-b',
          { text: 'look at this', artifact: { id: 'art1', title: 'Deploy 报告.md', updatedAt: 200 } },
          200,
        ),
      ],
    ],
    ['bot-hidden', [entryOf('e4', 'bot-hidden', { text: 'hidden deploy note' })]],
  ])
  const entriesOf = (botId: string) => index.get(botId) ?? []

  it('正文命中（大小写不敏感）', () => {
    const hits = searchLoadedEntries(bots, entriesOf, 'DEPLOY script')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.entry.id).toBe('e1')
    expect(hits[0]?.matched).toBe('text')
  })

  it('附件名命中', () => {
    const hits = searchLoadedEntries(bots, entriesOf, 'report-final')
    expect(hits[0]?.matched).toBe('file')
    expect(hits[0]?.snippet).toContain('report-final.pdf')
  })

  it('工件标题命中', () => {
    const hits = searchLoadedEntries(bots, entriesOf, 'deploy 报告')
    expect(hits[0]?.matched).toBe('artifact')
  })

  it('隐藏 Bot 的条目不出现', () => {
    expect(searchLoadedEntries(bots, entriesOf, 'hidden deploy')).toHaveLength(0)
  })

  it('空/纯空白查询返回空数组；按更新时间倒序', () => {
    expect(searchLoadedEntries(bots, entriesOf, '   ')).toEqual([])
    const hits = searchLoadedEntries(bots, entriesOf, 'deploy')
    // e3（updatedAt 200）在 e1（updatedAt 100）前；hidden 不在。
    expect(hits.map((h) => h.entry.id)).toEqual(['e3', 'e1'])
  })
})
