/**
 * MockTransport —— Phase 0 演示与测试专用内存假主机。
 * 不连接任何真实主机：实现 HostTransport 同一接口，让 AppModel/UI/测试在
 * ChannelTransport（E2E 握手，Phase 1 联调）就绪前就能跑通完整数据流。
 * 事件顺序与主机一致（砚台核对）：hello → bot 事件追平 → entry 事件。
 */
import type { Entry, Hello, HostEvent, ScreenState } from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import { HostError, type HostTransport } from './host-transport'

export class MockTransport implements HostTransport {
  private bots = [
    normalizeBot({
      id: 'bot-claude',
      kind: 'agent',
      name: 'Claude 演示',
      description: '本地模拟的 Claude Code Bot',
      avatarColor: '#d97757',
      avatarShape: 'circle',
      backend: 'claude-code',
      cwd: '~/demo',
      managedWorkspace: true,
      permission: 'auto',
      mode: null,
      modelOptions: {},
      fastMode: false,
      fastModeSupport: 'unknown',
      fastModeIssue: null,
      fallbacks: [],
      members: [],
      status: 'idle',
      rev: 1,
      position: 0,
      unread: 0,
      section: '演示',
    }),
    normalizeBot({
      id: 'bot-codex',
      kind: 'agent',
      name: 'Codex 演示',
      description: '本地模拟的 Codex Bot',
      avatarColor: '#5b9bd5',
      avatarShape: 'circle',
      backend: 'codex',
      cwd: '~/demo',
      managedWorkspace: true,
      permission: 'ask',
      mode: null,
      modelOptions: {},
      fastMode: false,
      fastModeSupport: 'unknown',
      fastModeIssue: null,
      fallbacks: [],
      members: [],
      status: 'idle',
      rev: 1,
      position: 1,
      unread: 0,
      section: '演示',
    }),
  ]
  private entries = new Map<string, Entry[]>()
  private seq = 1
  private rev = 1

  constructor(private readonly hostName = '演示主机') {}

  private entry(botId: string, kind: string, data: Record<string, unknown>): Entry {
    this.seq += 1
    this.rev += 1
    return { id: `e${this.seq}`, seq: this.seq, botId, rev: this.rev, kind, turn: 1, data, createdAt: Date.now(), updatedAt: Date.now() }
  }

  async call<T>(method: string, body?: unknown): Promise<T> {
    await new Promise((r) => setTimeout(r, 120))
    const b = (body ?? {}) as Record<string, unknown>
    switch (method) {
      case 'hello': {
        const hello: Hello = {
          hostId: 'mock-host',
          computerId: 'NHUPmL1Z_PyUbaRaqr6TOw',
          name: this.hostName,
          version: '2.38.0-mock',
          os: 'demo',
          backends: [],
          rev: this.rev,
        }
        return hello as T
      }
      case 'history': {
        const list = this.entries.get(String(b.botId)) ?? []
        return { entries: list } as T
      }
      case 'send': {
        const botId = String(b.botId)
        const userEntry = this.entry(botId, 'user', { text: String(b.text ?? '') })
        this.push(userEntry)
        const reply = this.entry(botId, 'agent', { text: `（演示模式回声）收到：${String(b.text ?? '')}`, final: true })
        this.push(reply)
        return { entry: userEntry } as T
      }
      default:
        throw new HostError(404, `演示模式未实现方法：${method}`)
    }
  }

  private push(entry: Entry) {
    const list = this.entries.get(entry.botId) ?? []
    list.push(entry)
    this.entries.set(entry.botId, list)
    this.emit({ type: 'entry', rev: entry.rev, entry })
  }

  stream(path: string, onData: (event: unknown) => void, onEnd: (error: HostError | null) => void): () => void {
    if (!path.startsWith('/events')) {
      onEnd(new HostError(404, `演示模式未实现流：${path}`))
      return () => {}
    }
    this.eventSink = onData
    queueMicrotask(() => {
      onData({ type: 'hello', hostId: 'mock-host', computerId: 'mock', rev: this.rev, usage: { providers: [] }, screen: MockTransport.mockScreen, network: null, catchUp: this.bots.length } satisfies HostEvent)
      for (const bot of this.bots) onData({ type: 'bot', rev: bot.rev, bot } satisfies HostEvent)
    })
    return () => {
      this.eventSink = null
      onEnd(null)
    }
  }

  private eventSink: ((event: unknown) => void) | null = null

  private static mockScreen: ScreenState = {
    enabled: false,
    connected: false,
    platform: 'demo',
    capture: false,
    input: false,
    displays: [],
    userControl: false,
    agentBot: null,
    computerUse: false,
    viewers: 0,
  }

  private emit(event: HostEvent) {
    this.eventSink?.(event)
  }
}
