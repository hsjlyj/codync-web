/**
 * MockTransport 的终端与屏幕模拟（Phase 3）：事件形状与真实主机一致（砚台 dbcf53d 核实）。
 * 终端：`agentSetup {step, backend?, cols?, rows?}` → `{term}`（host.rs:114-121；step=node 时免 backend）；
 * 订阅 `/term/<id>`：先回放 scrollback（对应主机 attach 的 head），再实时下发
 * `{"type":"output","data":<base64>}` / `{"type":"exit","code":n}`（term.rs:59/74/79）；
 * 已退出的终端再订阅以 404「that terminal is gone」拒绝（subscriptions.rs:69-73）。
 * 屏幕：顺序约束照主机执行——必须先开 `screenCandidates` 订阅再发 `screenOffer`
 * （signaling.rs:134），先 offer 后订阅会被拒；candidate 为 tagged enum
 * `{type:"candidate",candidate,sdpMLineIndex,sdpMid}` / `{type:"complete"}`（signaling.rs:17-28）。
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

interface MockScreen {
  subscribedOnce: boolean
  offered: boolean
  closed: boolean
  sink: ((event: unknown) => void) | null
  timers: ReturnType<typeof setTimeout>[]
}

export class MockRemote {
  private terms = new Map<string, MockTerm>()
  private screens = new Map<string, MockScreen>()
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
      case 'screenPrepare': {
        const session = `screen-mock-${++this.seq}`
        this.screens.set(session, { subscribedOnce: false, offered: false, closed: false, sink: null, timers: [] })
        // 演示无中继：iceServers 空数组 + trickle（与 IceConfig::default 同形状，viewer.rs:29-33）。
        return { session, iceServers: [], expiresAt: Date.now() + 3_600_000, trickle: b.trickle !== false } as T
      }
      case 'screenOffer': {
        const session = this.requireScreen(String(b.session ?? ''))
        // 顺序约束镜像（signaling.rs:131-141）：未先订阅 → 400；重复 offer → 400。
        if (!session.subscribedOnce) throw new HostError(400, 'open screenCandidates before offering')
        if (session.offered) throw new HostError(400, 'screen session already offered')
        session.offered = true
        this.scheduleHostCandidates(session)
        return { session: String(b.session), sdp: 'v=0\r\n（演示应答 SDP，非真实视频流）\r\n' } as T
      }
      case 'screenCandidate': {
        const session = this.requireScreen(String(b.session ?? ''))
        if (!session.offered) throw new HostError(400, 'screen candidate is not ready')
        return {} as T
      }
      case 'screenClose': {
        const session = this.screens.get(String(b.session ?? ''))
        if (session) this.closeScreen(session)
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

  /** screenCandidates 订阅（`/screen-candidates?session=<id>`）：每个会话只能开一次（signaling.rs:187）。 */
  screenStream(path: string, onData: (event: unknown) => void, onEnd: (error: HostError | null) => void): () => void {
    const sessionId = new URL(path, 'https://channel.invalid').searchParams.get('session') ?? ''
    const session = this.screens.get(sessionId)
    if (!session || session.closed) {
      onEnd(new HostError(400, 'unknown screen session'))
      return () => {}
    }
    if (session.subscribedOnce) {
      onEnd(new HostError(400, 'screen candidates already subscribed'))
      return () => {}
    }
    session.subscribedOnce = true
    session.sink = onData
    onData({ type: 'ready' }) // 首事件（signaling.rs:210）
    return () => {
      if (session.sink === onData) session.sink = null
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

  private requireScreen(id: string): MockScreen {
    const session = this.screens.get(id)
    if (!session || session.closed) throw new HostError(400, 'unknown screen session')
    return session
  }

  /** 应答后向订阅者推两条演示 candidate 与 complete（顺序与主机一致：先候选后完结）。 */
  private scheduleHostCandidates(session: MockScreen) {
    const candidates = [
      {
        type: 'candidate',
        candidate: 'candidate:1 1 udp 2130706431 10.0.0.1 50001 typ host',
        sdpMLineIndex: 0,
        sdpMid: '0',
      },
      {
        type: 'candidate',
        candidate: 'candidate:2 1 udp 2130706431 10.0.0.1 50002 typ host',
        sdpMLineIndex: 0,
        sdpMid: '0',
      },
      { type: 'complete' },
    ]
    candidates.forEach((event, index) => {
      session.timers.push(setTimeout(() => session.sink?.(event), 40 * (index + 1)))
    })
  }

  private closeScreen(session: MockScreen) {
    for (const timer of session.timers) clearTimeout(timer)
    session.timers = []
    session.closed = true
    session.sink = null
  }
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
