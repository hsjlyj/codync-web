'use client'

/**
 * 消息 Markdown 渲染（桌面端 Markdown.tsx 的 Web 版）：markdown-blocks.ts 的块级结构 + 行内样式。
 * 行内支持 `code`、**bold**、__bold__、*italic*、_italic_、~~strike~~、[链接](url)。
 * 链接行为：Web 端新标签页打开（桌面端是 openExternal 桥）。
 */
import { memo, type ReactNode } from 'react'
import { parseMarkdown, type Block } from './markdown-blocks'

export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  // Code spans first: nothing inside them is styled.
  text.split(/(`[^`\n]+`)/).forEach((part, i) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      out.push(
        <code
          key={`${key}${i}`}
          className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[0.85em] text-emerald-300"
        >
          {part.slice(1, -1)}
        </code>,
      )
    } else if (part) out.push(...emphasis(part, `${key}${i}-`))
  })
  return out
}

const pattern =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])/
function emphasis(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    const m = pattern.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const k = `${key}${n++}`
    if (m[1] !== undefined) {
      const url = m[2]!
      out.push(
        <a
          key={k}
          href={url}
          title={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline decoration-sky-400/40 underline-offset-2 hover:decoration-sky-400"
        >
          {emphasis(m[1], `${k}-`)}
        </a>,
      )
    } else if (m[3] !== undefined || m[4] !== undefined)
      out.push(
        <strong key={k} className="font-semibold text-neutral-50">
          {emphasis(m[3] ?? m[4]!, `${k}-`)}
        </strong>,
      )
    else if (m[5] !== undefined) out.push(<s key={k}>{emphasis(m[5], `${k}-`)}</s>)
    else out.push(<em key={k}>{emphasis(m[6] ?? m[7]!, `${k}-`)}</em>)
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

const MarkdownBlock = memo(
  function MarkdownBlock({ block }: { block: Block }) {
    switch (block.kind) {
      case 'paragraph':
        return <p className="whitespace-pre-wrap">{inline(block.text)}</p>
      case 'heading': {
        const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm'
        return <div className={`${size} font-semibold text-neutral-50`}>{inline(block.text)}</div>
      }
      case 'bullet':
        return (
          <div className="flex gap-2" style={{ paddingLeft: block.depth * 16 }}>
            <span className="shrink-0 text-neutral-500">{block.marker}</span>
            <span className="min-w-0 whitespace-pre-wrap">{inline(block.text)}</span>
          </div>
        )
      case 'rule':
        return <hr className="border-neutral-800" />
      case 'table': {
        const columns = Math.max(block.header.length, ...block.rows.map((r) => r.length))
        return (
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  {Array.from({ length: columns }, (_, i) => (
                    <th
                      key={i}
                      className="border-b border-neutral-700 px-2.5 py-1 text-left font-semibold text-neutral-200"
                    >
                      {inline(block.header[i] ?? '', `h${i}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {Array.from({ length: columns }, (_, i) => (
                      <td key={i} className="border-b border-neutral-800/60 px-2.5 py-1 text-neutral-300">
                        {inline(row[i] ?? '', `${r}-${i}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      case 'quote':
        return (
          <blockquote className="border-l-2 border-neutral-600 pl-3 text-neutral-400">{inline(block.text)}</blockquote>
        )
      case 'code':
        return (
          <div className="overflow-x-auto rounded-lg bg-neutral-950">
            {block.language && (
              <div className="border-b border-neutral-800 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500">
                {block.language}
              </div>
            )}
            <pre className="select-text p-3 font-mono text-xs leading-relaxed text-neutral-300">{block.text}</pre>
          </div>
        )
    }
  },
  (a, b) => JSON.stringify(a.block) === JSON.stringify(b.block),
)

/** 一条消息的 Markdown；未变化的块保持原渲染（memo）。 */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <div className="select-text flex flex-col gap-2.5 text-sm leading-relaxed text-neutral-200">
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} />
      ))}
    </div>
  )
})
