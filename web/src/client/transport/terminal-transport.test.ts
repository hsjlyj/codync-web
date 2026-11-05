/**
 * 终端传输层契约（试金 QA）：订阅封套的路径解析 + TerminalController 的输出解码。
 *
 * 主机事实：`agentSetup` 返回 UUID 形状的 term id（host/src/agent/term.rs:150
 * `Uuid::new_v4()`），订阅走 `{"id","sub":"term","b":{"term":<id>}}`，事件为
 * `{"type":"output","data":<base64>}` 与 `{"type":"exit","code":n}`（term.rs:59/74/79）。
 */
import { describe, expect, it } from 'vitest'
import { parseStreamPath } from './channel-transport'
import { toBase64 } from './bytes'
import { TerminalController } from '../store/terminal'

const UUID = '3f2f1a4c-9d0e-4b7a-8c15-2e6b0a9d4f31'

describe('parseStreamPath：终端与 ICE 订阅封套', () => {
  it('/term/<uuid> → sub=term，b.term 原样取路径尾段', () => {
    expect(parseStreamPath(`/term/${UUID}`)).toEqual({ sub: 'term', b: { term: UUID } })
  })

  it('/screen-candidates?session= → sub=screenCandidates', () => {
    expect(parseStreamPath('/screen-candidates?session=s1')).toEqual({
      sub: 'screenCandidates',
      b: { session: 's1' },
    })
  })

  it('/events 带上 since 与 client', () => {
    expect(parseStreamPath('/events?since=5&client=web')).toEqual({
      sub: 'events',
      b: { since: 5, client: 'web' },
    })
  })

  it('未知路径抛错，不静默发一个空订阅', () => {
    expect(() => parseStreamPath('/nope')).toThrow('未支持的流路径：/nope')
  })
})

/** 用假 transport 直接喂输出事件（一次 start 只建一个终端）。 */
const controllerWith = (chunks: Uint8Array[], onOutput: (s: string) => void) => {
  const transport = {
    call: async <T,>(method: string) => (method === 'agentSetup' ? ({ term: UUID } as T) : ({} as T)),
    stream: (_path: string, onData: (e: unknown) => void) => {
      for (const chunk of chunks) onData({ type: 'output', data: toBase64(chunk) })
      return () => {}
    },
  }
  return new TerminalController(transport, { onOutput, onStage: () => {} })
}

describe('TerminalController 输出解码', () => {
  it('整块 UTF-8 原样透出', async () => {
    const seen: string[] = []
    const controller = controllerWith([new TextEncoder().encode('中文')], (s) => seen.push(s))
    await controller.start({ backend: 'claude-code', step: 'install' })
    expect(seen.join('')).toBe('中文')
  })

  // 已知缺陷（待 希音 修）：onTermEvent 逐块调用 TextDecoder.decode(bytes) 而不带
  // { stream: true }（store/terminal.ts:112），因此多字节字符被主机切在两个 chunk
  // 之间时，两块都会解出 U+FFFD。主机按读缓冲区切分，切在字符中间是常态。
  // 修好之后删掉 .fails —— 判定标准：两个块合起来必须还原为 '中'。
  it.fails('跨 chunk 拆开的 UTF-8 字符应还原（当前输出 U+FFFD）', async () => {
    const bytes = new TextEncoder().encode('中')
    const seen: string[] = []
    const controller = controllerWith([bytes.subarray(0, 1), bytes.subarray(1)], (s) => seen.push(s))
    await controller.start({ backend: 'claude-code', step: 'install' })
    expect(seen.join('')).toBe('中')
  })
})
