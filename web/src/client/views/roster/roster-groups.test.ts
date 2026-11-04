/** 花名册分组纯函数测试（Phase 2）：隐藏过滤、置顶排前、section 按首现顺序、全未分组无区头。 */
import { describe, expect, it } from 'vitest'
import type { Bot } from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import { UNGROUPED_LABEL, rosterGroups } from './roster-groups'

const botOf = (id: string, extra: Partial<Bot> = {}): Bot =>
  normalizeBot({ id, name: id, backend: 'claude', cwd: '', ...extra })

describe('rosterGroups', () => {
  it('隐藏 Bot 不显示', () => {
    const groups = rosterGroups([botOf('a'), botOf('gone', { hidden: true })])
    expect(groups.flatMap((g) => g.bots.map((b) => b.id))).toEqual(['a'])
  })

  it('全未分组：单一组、无区头（label 为空）', () => {
    const groups = rosterGroups([botOf('a'), botOf('b')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.section).toBeNull()
    expect(groups[0]?.label).toBe('')
  })

  it('有分组时：未分组区带「未分组」头，section 按首现顺序', () => {
    const groups = rosterGroups([
      botOf('w1', { section: 'Work' }),
      botOf('u1'),
      botOf('p1', { section: 'Personal' }),
      botOf('w2', { section: 'Work' }),
    ])
    expect(groups.map((g) => g.label)).toEqual([UNGROUPED_LABEL, 'Work', 'Personal'])
    expect(groups[0]?.bots.map((b) => b.id)).toEqual(['u1'])
    expect(groups[1]?.bots.map((b) => b.id)).toEqual(['w1', 'w2'])
  })

  it('置顶（pinned/lead）在未分组区排前', () => {
    const groups = rosterGroups([botOf('a'), botOf('lead', { lead: true }), botOf('pin', { pinned: true })])
    expect(groups[0]?.bots.map((b) => b.id)).toEqual(['lead', 'pin', 'a'])
  })
})
