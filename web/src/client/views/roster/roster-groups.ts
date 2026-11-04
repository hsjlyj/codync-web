/**
 * 花名册分组（Phase 2，纯函数）：隐藏 Bot 不显示；未分组（含置顶/lead）在前，
 * section 按 bots 数组里首次出现的顺序排（数组本身已按 position 排序，AppModel.sortedBots）。
 */
import type { Bot } from '@codync/shared'

export interface RosterGroup {
  /** null = 未分组区。 */
  section: string | null
  label: string
  bots: Bot[]
}

export const UNGROUPED_LABEL = '未分组'

/** 置顶（pinned 或 lead）排前，其余保持传入顺序（桌面端 roster 同语义）。 */
const pinnedFirst = (bots: Bot[]): Bot[] => {
  const pinned = bots.filter((b) => b.pinned || b.lead)
  const rest = bots.filter((b) => !b.pinned && !b.lead)
  return [...pinned, ...rest]
}

export function rosterGroups(bots: Bot[]): RosterGroup[] {
  const visible = bots.filter((b) => !b.hidden)
  const sections: string[] = []
  for (const bot of visible) {
    if (bot.section && !sections.includes(bot.section)) sections.push(bot.section)
  }
  const groups: RosterGroup[] = []
  const ungrouped = pinnedFirst(visible.filter((b) => !b.section))
  // 只有存在分组时才渲染未分组区头（也是拖拽移出分组的落点）；全未分组则不加头。
  if (ungrouped.length > 0 && sections.length > 0) {
    groups.push({ section: null, label: UNGROUPED_LABEL, bots: ungrouped })
  } else if (ungrouped.length > 0) {
    groups.push({ section: null, label: '', bots: ungrouped })
  }
  for (const section of sections) {
    groups.push({ section, label: section, bots: visible.filter((b) => b.section === section) })
  }
  return groups
}
