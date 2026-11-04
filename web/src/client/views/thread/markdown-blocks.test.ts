import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './markdown-blocks'

describe('parseMarkdown', () => {
  it('fenced code keeps raw lines and language tag', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1\nif (a) {\n  log(a)\n}\n```')
    expect(blocks).toEqual([{ kind: 'code', text: 'const a = 1\nif (a) {\n  log(a)\n}', language: 'ts' }])
  })

  it('unterminated fence still yields one code block', () => {
    expect(parseMarkdown('```js\nlet x = 1')).toEqual([{ kind: 'code', text: 'let x = 1', language: 'js' }])
  })

  it('headings, bullets with nesting, ordered lists and quotes', () => {
    const blocks = parseMarkdown('## 标题\n- 第一项\n  - 嵌套项\n1. 有序\n> 引用一句')
    expect(blocks).toEqual([
      { kind: 'heading', text: '标题', level: 2 },
      { kind: 'bullet', text: '第一项', marker: '•', depth: 0 },
      { kind: 'bullet', text: '嵌套项', marker: '◦', depth: 1 },
      { kind: 'bullet', text: '有序', marker: '1.', depth: 0 },
      { kind: 'quote', text: '引用一句' },
    ])
  })

  it('a header plus |---| line makes a table, anything less stays text', () => {
    expect(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual([
      { kind: 'table', header: ['a', 'b'], rows: [['1', '2']] },
    ])
    expect(parseMarkdown('| a | b |\n| x | y |')).toEqual([{ kind: 'paragraph', text: '| a | b |\n| x | y |' }])
  })

  it('rules and paragraph grouping', () => {
    const blocks = parseMarkdown('第一段\n继续\n\n---\n第二段')
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '第一段\n继续' },
      { kind: 'rule' },
      { kind: 'paragraph', text: '第二段' },
    ])
  })
})
