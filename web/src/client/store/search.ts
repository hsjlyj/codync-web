/**
 * 消息搜索（Phase 2，纯函数）：主机没有全量历史 search 方法（渡口核实），
 * Phase 2 按既定方案做客户端本地过滤——只搜当前已加载进内存的条目。
 * 匹配范围：消息正文、附件/分享文件名、工件标题；大小写不敏感；隐藏 Bot 跳过。
 */
import type { Bot, Entry } from '@codync/shared'

export interface SearchHit {
  bot: Bot
  entry: Entry
  /** 命中来源：正文 / 附件名 / 工件标题。 */
  matched: 'text' | 'file' | 'artifact'
  /** 命中词附近的摘要（含省略号），UI 高亮用原始 query 再切分。 */
  snippet: string
}

const SNIPPET_RADIUS = 48

/** 在 text 中找 query（大小写不敏感），返回命中位置附近的摘要；未命中返回 null。 */
export function snippetAround(text: string, query: string): string | null {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const at = haystack.indexOf(needle)
  if (at < 0) return null
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + needle.length + SNIPPET_RADIUS)
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return `${head}${text.slice(start, end)}${tail}`
}

/** 在一个条目里找第一个命中的字段。 */
function matchEntry(entry: Entry, query: string): SearchHit['matched'] | null {
  const text = entry.data.text
  if (typeof text === 'string' && snippetAround(text, query)) return 'text'
  const attachments = entry.data.attachments ?? entry.data.files ?? []
  for (const file of attachments) {
    if (typeof file?.name === 'string' && snippetAround(file.name, query)) return 'file'
  }
  const artifact = entry.data.artifact
  if (artifact && typeof artifact.title === 'string' && snippetAround(artifact.title, query)) return 'artifact'
  return null
}

/** 生成命中条目的摘要（正文优先，其次文件名/工件标题）。 */
function snippetOf(entry: Entry, query: string, matched: SearchHit['matched']): string {
  if (matched === 'text' && typeof entry.data.text === 'string') {
    return snippetAround(entry.data.text, query) ?? ''
  }
  if (matched === 'artifact' && typeof entry.data.artifact?.title === 'string') {
    return snippetAround(entry.data.artifact.title, query) ?? ''
  }
  const files = [...(entry.data.attachments ?? []), ...(entry.data.files ?? [])]
  const file = files.find((f) => typeof f?.name === 'string' && snippetAround(f.name, query))
  return file ? (snippetAround(file.name, query) ?? '') : ''
}

/**
 * 跨 Bot 本地搜索已加载条目。entriesOf 由调用方给（AppModel.entriesOf），
 * 保持本函数纯函数：不触模型、不发请求。
 */
export function searchLoadedEntries(
  bots: Bot[],
  entriesOf: (botId: string) => Entry[],
  query: string,
  limit = 200,
): SearchHit[] {
  const needle = query.trim()
  if (!needle) return []
  const hits: SearchHit[] = []
  for (const bot of bots) {
    if (bot.hidden) continue
    for (const entry of entriesOf(bot.id)) {
      const matched = matchEntry(entry, needle)
      if (!matched) continue
      hits.push({ bot, entry, matched, snippet: snippetOf(entry, needle, matched) })
      if (hits.length >= limit) return hits
    }
  }
  return hits.sort((a, b) => b.entry.updatedAt - a.entry.updatedAt || b.entry.seq - a.entry.seq)
}
