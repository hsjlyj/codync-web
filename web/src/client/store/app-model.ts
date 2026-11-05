/**
 * AppModel —— Web 端主状态管理的编排核心（远程模式）。
 * 同步契约按砚台的 api-types.ts「Sync model」注释实现：
 * 全局 rev 游标、按 id upsert、不跳过不可解码事件，resync 时从 0 重追。
 * 初始化顺序（主机事实，砚台核对）：call hello → 订阅 events（since=0）→ 追平转实时。
 * 本文件只留连接生命周期、事件分发与快照通知；领域状态在旁模块：
 * - entry-state.ts：条目存储、乐观发送、历史分页、上传/下载（EntryState）
 * - bot-state.ts：花名册 upsert 与删除收窄（BotState）
 * - real-host.ts：/channel E2E + 配对编排（connectToRealHost）
 * - bot-admin.ts：Bot CRUD/排序/分组（BotAdmin）
 * 快照形状见 snapshot.ts；桌面端对应物 apps/desktop/src/renderer/store/app-model.ts（上游仓库，本仓库已移除）。
 */
import type { Attachment, Entry, Hello, HostEvent, Usage } from '@codync/shared'
import { clearDevice } from '../transport/device-key'
import type { HostTransport } from '../transport/host-transport'
import { BotAdmin } from './bot-admin'
import { BotState } from './bot-state'
import { EntryState } from './entry-state'
import { connectToRealHost, type ConnectRealHostParams } from './real-host'
import { INITIAL, type AppSnapshot, type ConnectionState } from './snapshot'

export type { AppSnapshot, ConnectionState }

export class AppModel {
  /** Bot 管理编排（CRUD/排序/分组/目录浏览）——I/O 仍在 store 层，视图只调用它。 */
  readonly admin = new BotAdmin(this)
  private readonly botState = new BotState(this)
  private readonly entries = new EntryState(this)
  private transportRef: HostTransport | null = null
  private stopEvents: (() => void) | null = null
  private listeners = new Set<() => void>()
  private snap: AppSnapshot = { ...INITIAL }

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

  // MARK: 能力面（EntryState/BotState/real-host 经此触达传输与快照，不改行为）

  transport = (): HostTransport | null => this.transportRef
  selectedBotId = (): string | null => this.snap.selectedBotId
  entriesVersion = (): number => this.snap.entriesVersion
  rev = (): number => this.snap.rev
  emit = (patch: Partial<AppSnapshot>): void => this.changed(patch)
  /** 供连接编排上报失败细节（原 connectRealHost 内联的 changed 调用）。 */
  reportError = (message: string): void => this.changed({ lastError: message })

  // MARK: 通道调用（编排层用）

  /** 加密通道上的方法调用；未连接即抛错。 */
  call<T = unknown>(method: string, body?: unknown): Promise<T> {
    if (!this.transportRef) return Promise.reject(new Error('未连接主机'))
    return this.transportRef.call<T>(method, body)
  }

  // MARK: 连接

  /** 接入一个传输实现（ChannelTransport 或 MockTransport）并开始同步。 */
  async connect(transport: HostTransport, onStatus?: (s: ConnectionState, detail?: string) => void) {
    this.disconnect()
    this.transportRef = transport
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

  /** 真实主机连接（/channel E2E + 配对）；编排体在 real-host.ts。 */
  connectRealHost(params: ConnectRealHostParams): Promise<void> {
    return connectToRealHost(this, params)
  }

  /** 主机侧移除了本设备（4003）后忘记本地密钥，下次需重新配对。 */
  async forgetDevice(): Promise<void> {
    await clearDevice()
  }

  disconnect() {
    this.stopEvents?.()
    this.stopEvents = null
    this.transportRef = null
    this.resetData({ connection: 'closed' })
  }

  private resetData(patch: Partial<AppSnapshot> = {}) {
    this.botState.clear()
    this.entries.clear()
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
      case 'bot':
        this.botState.applyBotEvent(event)
        break
      case 'entry':
        this.upsertEntry(event.entry)
        this.changed({ rev: Math.max(this.snap.rev, event.rev), entriesVersion: this.snap.entriesVersion + 1 })
        break
      case 'resync':
        // 追不上了（缓冲溢出）：清空从 0 重追，不跳过事件。
        this.stopEvents?.()
        this.resetData()
        if (this.transportRef) void this.connect(this.transportRef)
        break
      default:
        // artifact/icons/call/…Phase 2 接入；未知类型按契约忽略但不中断。
        break
    }
  }

  // MARK: 权限回应与未读

  async respondPermission(entryId: string, optionId: string | null): Promise<void> {
    if (!this.transportRef) throw new Error('未连接主机')
    this.changed({ respondingEntryId: entryId })
    try {
      // 主机从 entry 的 author 推导 Bot，不传 botId（砚台核对 api/bots.rs:270 注释）。
      await this.transportRef.call('respondPermission', { entryId, optionId })
    } finally {
      if (this.snap.respondingEntryId === entryId) this.changed({ respondingEntryId: null })
    }
  }

  /** 打开聊天时清除未读（尽力而为：标记失败不影响使用）。 */
  async markRead(botId: string): Promise<void> {
    if (!this.transportRef) return
    try {
      await this.transportRef.call('markRead', { botId })
    } catch {
      // 未读标记失败不影响聊天功能，主机下次事件会带回 unread 修正。
    }
  }

  // MARK: 查询与委托（对外 API 与拆分前一致；实现见各状态模块）

  entriesOf(botId: string | null): Entry[] {
    return this.entries.entriesOf(botId)
  }

  select(botId: string | null) {
    this.changed({ selectedBotId: botId })
  }

  selectedBot() {
    return this.snap.selectedBotId ? this.botState.byIdOf(this.snap.selectedBotId) : null
  }

  sendMessage(text: string, opts?: { replyTo?: string; attachments?: Attachment[] }): Promise<void> {
    return this.entries.sendMessage(text, opts)
  }

  /** 移除发送失败的本地占位条目（重试即重新发送一条新消息）。 */
  discardLocal(entryId: string) {
    this.entries.discardLocal(entryId)
  }

  /** 分块上传一组文件（384KB/块），返回附件元数据。 */
  uploadFiles(botId: string, files: File[], onProgress?: (done: number, total: number) => void): Promise<Attachment[]> {
    return this.entries.uploadFiles(botId, files, onProgress)
  }

  /** 首屏/翻页加载历史（beforeSeq 游标）。 */
  loadHistory(botId: string, beforeSeq?: number, limit = 100): Promise<void> {
    return this.entries.loadHistory(botId, beforeSeq, limit)
  }

  /** 该 Bot 的历史是否已翻到底（「加载更早」按钮的显隐）。 */
  historyExhaustedOf(botId: string): boolean {
    return this.entries.historyExhaustedOf(botId)
  }

  /** 当前已加载的最旧 seq（翻页游标）；无条目返回 null。 */
  oldestSeqOf(botId: string): number | null {
    return this.entries.oldestSeqOf(botId)
  }

  /** 整段读回一个上传文件（384KB 分块循环，主机 `readUpload`）。 */
  readUploadBytes(botId: string, uploadId: string): Promise<Uint8Array> {
    return this.entries.readUploadBytes(botId, uploadId)
  }

  /** 整段读回 Bot 分享的文件（主机 `readFile` 按 entryId+fileId 分块）。 */
  readEntryFileBytes(entryId: string, fileId: string): Promise<Uint8Array> {
    return this.entries.readEntryFileBytes(entryId, fileId)
  }

  /** 事件分支与测试共用的写入点（只写 map；entriesVersion 计数由调用方 bump）。 */
  private upsertEntry(entry: Entry) {
    this.entries.upsert(entry)
  }

  clearError() {
    this.changed({ lastError: null })
  }
}

/** 页面级单例（App Router 下各页面共享同一模型）。 */
export const appModel = new AppModel()
