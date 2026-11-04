/**
 * AppModel —— Web 端主状态管理（远程模式，Phase 1）。
 * 同步契约按砚台的 api-types.ts「Sync model」注释实现：
 * 全局 rev 游标、按 id upsert、不跳过不可解码事件，resync 时从 0 重追。
 * 初始化顺序（主机事实，砚台核对）：call hello → 订阅 events（since=0）→ 追平转实时。
 * 桌面端对应物：apps/desktop/src/renderer/store/app-model.ts（Observable + BotStore）；
 * Web 端简化为单主机 + useSyncExternalStore 快照。
 * Phase 1 新增：乐观发送（clientNonce 占位→主机确认替换）、历史分页、
 * 分块文件上传、权限回应、markRead。
 */
import type { Attachment, Bot, DeviceCertificate, Entry, Hello, HostEvent, Usage } from '@codync/shared'
import { normalizeBot, quoteOf } from '@codync/shared'
import { MAX_FILE_SIZE, UPLOAD_CHUNK, chunkRanges, fromBase64, toBase64 } from '../transport/bytes'
import { ChannelTransport } from '../transport/channel-transport'
import { clearDevice, createDeviceSigner, loadDeviceSigner, saveDeviceMeta } from '../transport/device-key'
import { HostError, type HostTransport, type TransportStatus } from '../transport/host-transport'
import { normalizeChannelUrl, parsePairingUrl } from '../transport/pairing-url'

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
  /** 正在回应的权限卡片（PermissionCard 按钮转圈用）。 */
  respondingEntryId: string | null
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
  respondingEntryId: null,
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

  // MARK: 真实主机连接（/channel E2E + 配对，编排在此、视图不持有 I/O）

  /**
   * 真实主机连接流程：
   * 1. 载入（或生成并持久化）设备签名密钥（WebCrypto non-extractable 优先，见 device-key.ts）；
   * 2. 给了配对码/配对链接且该主机尚未配对时走配对通道（一次 pair，成功后换普通连接）；
   * 3. 普通 /channel 连接 + 事件订阅（connect）。
   */
  async connectRealHost(params: {
    /** ws(s) 直连地址或 http(s) 主机地址；配对链接内含 urls 时可省略。 */
    url?: string
    /** 完整配对链接（codync://pair?...，含 computerId/sk/code/urls）。 */
    pairingLink?: string
    /** 手工输入的一次性配对码（需同时给 url + computerId）。 */
    pairCode?: string
    computerId?: string
    /** 主机 Ed25519 公钥（welcome 强校验）；配对链接的 sk 优先。 */
    signKey?: string
    deviceName?: string
    /** 云签发的设备证书（主机 2.38 配对必需，缺省将被 4400 拒绝）。 */
    certificate?: DeviceCertificate
    /** 设备平台（主机白名单 ios|macos|android，pairing.rs:35）。 */
    platform?: string
    onStage?: (stage: string) => void
  }): Promise<void> {
    const stage = (s: string) => params.onStage?.(s)
    stage('正在载入设备密钥…')
    const loaded = (await loadDeviceSigner()) ?? (await createDeviceSigner())
    const { signer, device } = loaded

    const parsed = params.pairingLink ? parsePairingUrl(params.pairingLink) : null
    if (params.pairingLink && !parsed) throw new Error('配对链接无法识别：请完整粘贴 codync://pair?... 链接')
    const url = normalizeChannelUrl(params.url ?? parsed?.urls[0] ?? '')
    const computerId = params.computerId?.trim() || parsed?.computerId || device?.computerId || ''
    const signKey = parsed?.signKey || params.signKey?.trim() || undefined
    const pairCode = parsed?.code ?? params.pairCode?.trim()
    if (!url) throw new Error('缺少主机地址（ws://… 或 http://…，或粘贴配对链接）')
    if (!computerId) throw new Error('缺少 computerId（配对链接内含，或手工填写）')

    const alreadyPaired = !!device && device.computerId === computerId
    if (pairCode && !alreadyPaired) {
      stage('正在配对…（请在主机上确认）')
      // 平台按 web 登记（主机白名单已加 web，pairing.rs:35）；老主机只认 ios/macos/android，
      // 平台校验在配对码核销之前（pairing.rs:34-39），被 400 拒后按 macos 过渡重试一次是安全的。
      const pairOnce = async (platform: string) => {
        const pairTransport = new ChannelTransport({
          url,
          computerId,
          hostSignKey: signKey,
          signer,
          clientName: 'web',
          pair: {
            code: pairCode,
            name: params.deviceName?.trim() || 'Codync Web',
            platform,
            ...(params.certificate ? { certificate: params.certificate } : {}),
          },
        })
        try {
          const reply = await pairTransport.pairOutcome()
          await saveDeviceMeta({
            computerId: reply.computerId,
            deviceName: params.deviceName?.trim() || 'Codync Web',
            signPubB64: signer.signPubB64,
            createdAt: Date.now(),
          })
        } finally {
          pairTransport.disconnect()
        }
      }
      try {
        await pairOnce(params.platform ?? 'web')
      } catch (e) {
        if (e instanceof HostError && e.status === 400 && /platform/i.test(e.message)) {
          stage('主机版本较旧，暂按 macos 平台登记…')
          await pairOnce('macos')
        } else {
          throw e
        }
      }
    }

    stage('正在连接主机…')
    const transport = new ChannelTransport({
      url,
      computerId,
      hostSignKey: signKey,
      signer,
      clientName: 'web',
      onStatus: (status, detail) => {
        if (status === 'failed') this.changed({ lastError: detail ?? '连接失败' })
      },
    })
    await this.connect(transport)
    if (this.snap.connection !== 'open') throw new Error(this.snap.lastError ?? '连接失败')
  }

  /** 主机侧移除了本设备（4003）后忘记本地密钥，下次需重新配对。 */
  async forgetDevice(): Promise<void> {
    await clearDevice()
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
    this.historyExhausted.clear()
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
    const map = this.entriesByBot.get(entry.botId) ?? new Map<string, Entry>()
    // 同 clientNonce 的本地占位条目被主机确认（send 返回或 events 推送）时移除，避免短暂双份。
    const nonce = entry.data?.clientNonce
    if (nonce) {
      for (const [id, local] of map) {
        if (id.startsWith('local-') && local.data.clientNonce === nonce) map.delete(id)
      }
    }
    map.set(entry.id, { ...entry, data: entry.data ?? {} })
    this.entriesByBot.set(entry.botId, map)
  }

  private sortedBots(): Bot[] {
    return [...this.botsById.values()].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name),
    )
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

  // MARK: 发送（乐观更新：本地先显示，主机确认后按 clientNonce 替换）

  async sendMessage(text: string, opts?: { replyTo?: string; attachments?: Attachment[] }): Promise<void> {
    const botId = this.snap.selectedBotId
    if (!botId || !this.transport) throw new Error('未选择 Bot 或未连接主机')
    const nonce = randomNonce()
    this.upsertLocal(botId, nonce, text, opts?.replyTo, opts?.attachments)
    this.sending += 1
    this.changed({ pendingSends: this.sending })
    try {
      const { entry } = await this.transport.call<{ entry: Entry }>('send', {
        botId,
        text,
        clientNonce: nonce,
        replyTo: opts?.replyTo,
        attachments: opts?.attachments?.map((a) => a.id),
      })
      this.upsertEntry(entry)
      this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
    } catch (e) {
      this.markLocalFailed(botId, nonce)
      throw e
    } finally {
      this.sending -= 1
      this.changed({ pendingSends: this.sending })
    }
  }

  /** 移除发送失败的本地占位条目（重试即重新发送一条新消息）。 */
  discardLocal(entryId: string) {
    for (const [botId, map] of this.entriesByBot) {
      if (!map.has(entryId)) continue
      map.delete(entryId)
      this.entriesByBot.set(botId, map)
      this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
      return
    }
  }

  private upsertLocal(botId: string, nonce: string, text: string, replyToId?: string, attachments?: Attachment[]) {
    const entries = this.entriesOf(botId)
    const seq = (entries.at(-1)?.seq ?? 0) + 1
    const now = Date.now()
    const quoted = replyToId ? entries.find((e) => e.id === replyToId) : undefined
    const local: Entry = {
      id: `local-${nonce}`,
      seq,
      botId,
      rev: 0,
      kind: 'user',
      turn: 0,
      data: {
        text,
        clientNonce: nonce,
        status: 'sending',
        replyTo: quoted ? quoteOf(quoted) : undefined,
        attachments,
      },
      createdAt: now,
      updatedAt: now,
    }
    this.upsertEntry(local)
    this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
  }

  private markLocalFailed(botId: string, nonce: string) {
    const map = this.entriesByBot.get(botId)
    const local = map?.get(`local-${nonce}`)
    if (!map || !local) return
    map.set(local.id, { ...local, data: { ...local.data, status: 'failed' } })
    this.entriesByBot.set(botId, map)
    this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
  }

  // MARK: 文件上传（分块 base64，主机 `upload` 追加，uploadId 即附件 id）

  /** 逐块上传一组文件；onProgress 汇报全局 (已完成块, 总块数)。 */
  async uploadFiles(
    botId: string,
    files: File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Attachment[]> {
    if (!this.transport) throw new Error('未连接主机')
    const attachments: Attachment[] = []
    let done = 0
    let total = 0
    const plans = files.map((file) => ({ file, ranges: chunkRanges(file.size) }))
    for (const plan of plans) total += Math.max(plan.ranges.length, 1)
    onProgress?.(0, total)
    for (const { file, ranges } of plans) {
      if (file.size > MAX_FILE_SIZE) throw new Error(`「${file.name}」超过 100 MB 上限`)
      const uploadId = randomNonce()
      const bytes = new Uint8Array(await file.arrayBuffer())
      for (const [start, end] of ranges.length ? ranges : ([[0, 0]] as Array<[number, number]>)) {
        await this.transport.call('upload', {
          botId,
          uploadId,
          name: file.name,
          data: toBase64(bytes.subarray(start, end)),
          offset: start,
          done: end >= file.size,
        })
        done += 1
        onProgress?.(done, total)
      }
      attachments.push({ id: uploadId, name: file.name, size: file.size })
    }
    return attachments
  }

  // MARK: 历史分页（主机 `history`：beforeSeq 向前翻，limit 1..500 默认 100）

  /** 首屏加载当前页；beforeSeq 省略时取最新一页。 */
  async loadHistory(botId: string, beforeSeq?: number, limit = 100): Promise<void> {
    if (!this.transport) throw new Error('未连接主机')
    const { entries } = await this.transport.call<{ entries: Entry[] }>('history', { botId, beforeSeq, limit })
    for (const entry of entries) this.upsertEntry(entry)
    this.historyExhausted.set(botId, entries.length < limit)
    this.changed({ entriesVersion: this.snap.entriesVersion + 1 })
  }

  /** 该 Bot 的历史是否已翻到底（「加载更早」按钮的显隐）。 */
  historyExhaustedOf(botId: string): boolean {
    return this.historyExhausted.get(botId) ?? false
  }

  /** 当前已加载的最旧 seq（翻页游标）；无条目返回 null。 */
  oldestSeqOf(botId: string): number | null {
    const first = this.entriesOf(botId)[0]
    return first ? first.seq : null
  }

  private historyExhausted = new Map<string, boolean>()

  // MARK: 权限回应

  async respondPermission(entryId: string, optionId: string | null): Promise<void> {
    if (!this.transport) throw new Error('未连接主机')
    this.changed({ respondingEntryId: entryId })
    try {
      // 主机从 entry 的 author 推导 Bot，不传 botId（砚台核对 api/bots.rs:270 注释）。
      await this.transport.call('respondPermission', { entryId, optionId })
    } finally {
      if (this.snap.respondingEntryId === entryId) this.changed({ respondingEntryId: null })
    }
  }

  /** 打开聊天时清除未读（尽力而为：标记失败不影响使用）。 */
  async markRead(botId: string): Promise<void> {
    if (!this.transport) return
    try {
      await this.transport.call('markRead', { botId })
    } catch {
      // 未读标记失败不影响聊天功能，主机下次事件会带回 unread 修正。
    }
  }

  // MARK: 文件下载（图片内联预览与文件卡片的字节来源）

  /** 整段读回一个上传文件（384KB 分块循环，主机 `readUpload`）。 */
  async readUploadBytes(botId: string, uploadId: string): Promise<Uint8Array> {
    if (!this.transport) throw new Error('未连接主机')
    const maxChunks = Math.ceil(MAX_FILE_SIZE / UPLOAD_CHUNK) + 8
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const res = await this.transport.call<{ data: string; size: number }>('readUpload', {
        botId,
        uploadId,
        offset: size,
      })
      const chunk = fromBase64(res.data)
      if (!chunk.length) break
      parts.push(chunk)
      size += chunk.length
      if (size >= res.size) break
      if (parts.length > maxChunks) throw new Error('文件读取超过安全上限')
    }
    return concatBytes(parts, size)
  }

  /** 整段读回 Bot 分享的文件（主机 `readFile` 按 entryId+fileId 分块）。 */
  async readEntryFileBytes(entryId: string, fileId: string): Promise<Uint8Array> {
    if (!this.transport) throw new Error('未连接主机')
    const maxChunks = Math.ceil(MAX_FILE_SIZE / UPLOAD_CHUNK) + 8
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const res = await this.transport.call<{ data: string; size: number }>('readFile', {
        entryId,
        fileId,
        offset: size,
      })
      const chunk = fromBase64(res.data)
      if (!chunk.length) break
      parts.push(chunk)
      size += chunk.length
      if (size >= res.size) break
      if (parts.length > maxChunks) throw new Error('文件读取超过安全上限')
    }
    return concatBytes(parts, size)
  }

  clearError() {
    this.changed({ lastError: null })
  }
}

const randomNonce = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.random()}`

const concatBytes = (parts: Uint8Array[], size: number): Uint8Array => {
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** 页面级单例（App Router 下各页面共享同一模型）。 */
export const appModel = new AppModel()
