/**
 * MockTransport 的终端模拟（Phase 3）：事件形状与真实主机一致（砚台 dbcf53d 核实）。
 * - `agentSetup {step, backend?, cols?, rows?}` → `{term}`（host.rs:114-121；step=node 时免 backend）
 * - 订阅 `/term/<id>`：先回放 scrollback（对应主机 attach 的 head），再实时下发
 *   `{"type":"output","data":<base64>}` / `{"type":"exit","code":n}`（term.rs:59/74/79）
 * - 已退出的终端再订阅以 404「that terminal is gone」拒绝（subscriptions.rs:69-73）
 * - 屏幕模拟（screenPrepare/screenCandidates/screenOffer）按 signaling.rs:134 顺序约束另见本文件下半部
 */
import type { TermEvent } from '@codync/shared'
import { toBase64 } from './bytes'
import { HostError } from './host-transport'

interface MockTerm {
  scrollback: string
  sink: ((event: TermEvent) => void) | null
  exited: boolean
  timers: ReturnType<typeof setTimeout>[]
}

export class MockRemote {
  private terms = new Map<string, MockTerm>()
  private seq = 0

  async call<T>(method: string, body?: unknown): Promise<T> {
    const b = (body ?? {}) as Record<string, unknown>
    switch (method) {
      case 'agentSetup': {
        const step = String(b.step ?? '')
        if (step !== 'install' && step !== 'login' && step !== 'node')
          throw new HostError(400, '`step` is install or login')
        const backend = String(b.backend ?? '')
        if (step !== 'node' && !backend) throw new HostError(400, '`backend` is required')
        const id = `term-mock-${++this.seq}`
        const term: MockTerm = { scrollback: '', sink: null, exited: false, timers: [] }
        this.terms.set(id, term)
        this.scheduleDemoOutput(term, step, backend)
        return { term: id } as T
      }
      case 'termInput': {
        this.write(
          this.requireTerm(String(b.term ?? '')),
          `\r\n> ${String(b.data ?? '')}\r\n（演示终端已收到输入）\r\n`,
        )
        return {} as T
      }
      case 'termResize': {
        this.requireTerm(String(b.term ?? ''))
        return {} as T
      }
      case 'termClose': {
        this.exitTerm(this.requireTerm(String(b.term ?? '')), 0)
        return {} as T
      }
      default:
        throw new HostError(404, `演示模式未实现方法：${method}`)
    }
  }

  /** term 订阅（`/term/<id>`）：注册 sink 并回放 scrollback；退订只摘 sink（与主机 cancel 语义一致）。 */
  termStream(path: string, onData: (event: unknown) => void, onEnd: (error: HostError | null) => void): () => void {
    const term = this.terms.get(path.slice('/term/'.length))
    if (!term || term.exited) {
      onEnd(new HostError(404, 'that terminal is gone'))
      return () => {}
    }
    term.sink = onData
    if (term.scrollback) onData(this.outputEvent(term.scrollback))
    return () => {
      if (term.sink === onData) term.sink = null
    }
  }

  // MARK: 内部

  private outputEvent(text: string): TermEvent {
    return { type: 'output', data: toBase64(utf8(text)) }
  }

  private requireTerm(id: string): MockTerm {
    const term = this.terms.get(id)
    if (!term || term.exited) throw new HostError(404, 'that terminal is gone')
    return term
  }

  private write(term: MockTerm, text: string) {
    term.scrollback += text
    term.sink?.(this.outputEvent(text))
  }

  private exitTerm(term: MockTerm, code: number) {
    for (const timer of term.timers) clearTimeout(timer)
    term.timers = []
    term.exited = true
    term.sink?.({ type: 'exit', code })
    term.sink = null
  }

  /** 演示安装/登录输出：几行横幅后保持打开（无真实进程，termClose 即退出）。 */
  private scheduleDemoOutput(term: MockTerm, step: string, backend: string) {
    const lines = [
      `Codync 演示终端（step: ${step}${backend ? `，backend: ${backend}` : ''}）\r\n`,
      `正在准备 ${backend || 'Node.js'} 环境…\r\n`,
      '✓ 依赖检查完成（演示数据，非真实进程输出）\r\n',
    ]
    lines.forEach((line, index) => {
      term.timers.push(setTimeout(() => this.write(term, line), 60 * (index + 1)))
    })
  }
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
