/**
 * TerminalController 行为测试（MockTransport 端到端）：
 * 启动→输出解码→输入微批→退出收尾→主动关闭。
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/mock-transport'
import { HostError } from '../transport/host-transport'
import { TerminalController, type TerminalStage } from './terminal'

/** mock call 有 120ms 固定延迟、演示输出定时器 60ms 间隔：统一用真实时钟轮询。 */
const until = async (predicate: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
  expect(predicate(), '等待条件超时').toBe(true)
}

const microtaskFlush = () => new Promise((r) => setTimeout(r, 0))

describe('TerminalController', () => {
  it('启动后收到解码输出并转为 running', async () => {
    const transport = new MockTransport()
    const output: string[] = []
    const stages: TerminalStage[] = []
    const controller = new TerminalController(transport, {
      onOutput: (chunk) => output.push(chunk),
      onStage: (stage) => stages.push(stage),
    })
    await controller.start({ backend: 'claude-code', step: 'install' })
    await until(() => stages.includes('running'))
    await until(() => output.join('').includes('演示终端'))
    await until(() => output.join('').includes('依赖检查完成'))
    controller.stop()
  })

  it('同步连击合并为一次 termInput（微批）', async () => {
    const transport = new MockTransport()
    const calls: string[] = []
    const counting = new Proxy(transport, {
      get(target, prop, receiver) {
        if (prop === 'call')
          return (method: string, body?: unknown) => {
            calls.push(method)
            return target.call(method, body)
          }
        return Reflect.get(target, prop, receiver)
      },
    })
    const controller = new TerminalController(counting, { onOutput: () => {}, onStage: () => {} })
    await controller.start({ backend: 'claude-code', step: 'install' })
    const before = calls.filter((m) => m === 'termInput').length
    controller.write('l')
    controller.write('s')
    controller.write('\r')
    await microtaskFlush()
    expect(calls.filter((m) => m === 'termInput').length).toBe(before + 1)
    controller.stop()
  })

  it('stop() 关闭会话：exit 事件 → exited', async () => {
    const transport = new MockTransport()
    const stages: TerminalStage[] = []
    const controller = new TerminalController(transport, {
      onOutput: () => {},
      onStage: (stage) => stages.push(stage),
    })
    await controller.start({ backend: 'claude-code', step: 'install' })
    await until(() => stages.includes('running'))
    controller.stop()
    await until(() => stages.includes('exited'))
    expect(stages.at(-2)).toBe('running')
  })

  it('启动失败（agentSetup 被拒）→ failed 并带原因', async () => {
    const stages: TerminalStage[] = []
    const broken = {
      call: () => Promise.reject(new Error('`step` is install or login')),
      stream: () => () => {},
    }
    const controller = new TerminalController(broken, {
      onOutput: () => {},
      onStage: (stage) => stages.push(stage),
    })
    await controller.start({ backend: 'claude-code', step: 'install' })
    expect(stages).toEqual(['starting', 'failed'])
  })

  it('流意外结束（未退出）→ failed 并带原因', async () => {
    const harness: { end: ((error: HostError | null) => void) | null } = { end: null }
    const transport = {
      call: async <T>(method: string) => (method === 'agentSetup' ? ({ term: 'term-x' } as T) : ({} as T)),
      stream: (_path: string, _onData: (e: unknown) => void, onEnd: (e: HostError | null) => void) => {
        harness.end = onEnd
        return () => {}
      },
    }
    const stages: TerminalStage[] = []
    const controller = new TerminalController(transport, {
      onOutput: () => {},
      onStage: (stage) => stages.push(stage),
    })
    await controller.start({ backend: 'claude-code', step: 'install' })
    harness.end?.(new HostError(0, '链路已断开'))
    expect(stages.at(-1)).toBe('failed')
  })
})
