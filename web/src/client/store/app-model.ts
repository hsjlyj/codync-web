/**
 * AppModel —— Web 端主状态管理（远程模式，Phase 0 骨架）。
 * 同步契约按砚台的 api-types.ts「Sync model」注释实现：
 * 全局 rev 游标、按 id upsert、不跳过不可解码事件，resync 时从 0 重追。
 * 初始化顺序（主机事实，砚台核对）：call hello → 订阅 events（since=0）→ 追平转实时。
 * 桌面端对应物：apps/desktop/src/renderer/store/app-model.ts（Observable + BotStore）；
 * Web 端简化为单主机 + useSyncExternalStore 快照，Phase 1 再按需拆 BotStore。
 */
import type { Bot, Entry, Hello, HostEvent, Usage } from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import type { HostTransport, TransportStatus } from '../transport/host-transport'

export type ConnectionState = TransportStatus

export interface AppSnapshot {
  connection: ConnectionState
  statusDetail: string | undefined
  lastError: string | null
  hello: Hello | null
  usage: Usage | null
  bots: Bot[]
  selectedBotId: string | null
  rev: number
  /** entries 变化计数：ThreadView 依赖它重渲染（Phase 3 换虚拟列表 + 细粒度订阅）。 */
  entriesVersion: number
  pendingSends: number
}

const INITIAL: AppSnapshot = {
  connection: 'idle',
  statusDetail: undefined,
  lastError: null,
  hello: null,
  usage: null,
  bots: [],
  selectedBotId: null,
  rev: 0,
  entriesVersion: 0,
  pendingSends: 0,
}

export class AppModel {
  private transport: HostTransport | null = null
  private stopEvents: (() => void) | null = null
  private botsById = new Map<string, Bot>()
  private entriesByBot = new Map<string, Map<string, Entry>>()
  private listeners = new Set<() => void>()
  private snap: AppSnapshot = { ...INITIAL }
  private sending = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AppSnapshot => this.snap

  private changed(patch: Partial<AppSnapshot> = {}) {
    this.snap = { ...this.snap, ...patch }
    for (const listener of this.listeners) listener()
  }

  // MARK: 连接

  /** 接入一个传输实现（ChannelTransport 或 MockTransport）并开始同步。 */
  async connect(transport: HostTransport, onStatus?: (s: ConnectionState, detail?: string) => void) {
    this.disconnect()
    this.transport = transport
    this.resetData({ connection: 'connecting', lastError: null })
    try {
      const hello = await transport.call<Hello>('hello')
      this.changed({ hello })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.changed({ connection: 'failed', lastError: error })
      onStatus?.('failed', error)
      return
    }
    this.stopEvents = transport.stream(
      '/events?since=0',
      (raw) => {
        const event = raw as HostEvent
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return
        this.applyEvent(event)
      },
      (error) => {
        this.changed({
          lastError: error ? error.message : '事件流结束（主机可能已断开）',
          connection: error ? this.snap.connection : 'reconnecting',
        })
      },
    )
    this.changed({ connection: 'open' })
    onStatus?.('open')
  }

  disconnect() {
    this.stopEvents?.()
    this.stopEvents = null
    this.transport = null
    this.resetData({ connection: 'closed' })
  }

  private resetData(patch: Partial<AppSnapshot> = {}) {
    this.botsById.clear()
    this.entriesByBot.clear()
    this.sending = 0
    this.changed({
      hello: null,
      usage: null,
      bots: [],
      selectedBotId: null,
      rev: 0,
      entriesVersion: this.snap.entriesVersion + 1,
      pendingSends: 0,
      ...patch,
    })
  }

  // MARK: 事件应用（sync 契约：rev 游标、按 id upsert、resync 从 0 重追）

  private applyEvent(event: HostEvent) {
    switch (event.type) {
      case 'hello':
        this.changed({ rev: event.rev, usage: (event.usage as Usage | undefined) ?? null })
        break
      case 'bot': {
        const bot = normalizeBot(event.bot as Partial<Bot> & { id: string })
        this.botsById.set(bot.id, bot)
        this.changed({ bots: this.sortedBots(), rev: Math.max(this.snap.rev, event.rev) })
        break
      }
      case 'entry':
        this.upsertEntry(event.entry)
        this.changed({ rev: Math.max(this.snap.rev, event.rev), entriesVersion: this.snap.entriesVersion + 1 })
        break
      case 'resync':
        // 追不上了（缓冲溢出）：清空从 0 重追，不跳过事件。
        this.stopEvents?.()
        this.resetData()
        if (this.transport) void this.connect(this.transport)
        break
      default:
        // artifact/icons/call/…Phase 2 接入；未知类型按契约忽略但不中断。
        break
    }
  }

  private upsertEntry(entry: Entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.botId !== 'string') return
    const withData = { ...entry, data: entry.data ?? {} }
    const map = this.entriesByBot.get(withData.botId) ?? new Map<string, Entry>()
    map.set(withData.id, withData)
    this.entriesByBot.set(withData.botId, map)
  }

  private sortedBots(): Bot[] {
    return [...this.botsById.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
  }

  // MARK: 查询

  entriesOf(botId: string | null): Entry[] {
    if (!botId) return []
    const map = this.entriesByBot.get(botId)
    if (!map) return []
    return [...map.values()].sort((a, b) => a.seq - b.seq)
  }

  select(botId: string | null) {
    this.changed({ selectedBotId: botId })
  }

  selectedBot(): Bot | null {
    return this.snap.selectedBotId ? (this.botsById.get(this.snap.selectedBotId) ?? null) : null
  }

  // MARK: 发送

  async sendMessage(text: string) {
    const botId = this.snap.selectedBotId
    if (!botId || !this.transport) throw new Error('未选择 Bot 或未连接主机')
    this.sending += 1
    this.changed({ pendingSends: this.sending })
    try {
      const { entry } = await this.transport.call<{ entry: Entry }>('send', { botId, text, clientNonce: randomNonce() })
      this.upsertEntry(entry)
      this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
    } finally {
      this.sending -= 1
      this.changed({ pendingSends: this.sending })
    }
  }

  clearError() {
    this.changed({ lastError: null })
  }
}

const randomNonce = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.random()}`

/** 页面级单例（App Router 下各页面共享同一模型）。 */
export const appModel = new AppModel()
