/**
 * MockTransport —— Phase 0 演示与测试专用内存假主机。
 * 不连接任何真实主机：实现 HostTransport 同一接口，让 AppModel/UI/测试在
 * ChannelTransport（E2E 握手，Phase 1 联调）就绪前就能跑通完整数据流。
 * 事件顺序与主机一致（砚台核对）：hello → bot 事件追平 → entry 事件。
 */
import type {
  Artifact,
  Attachment,
  Bot,
  BotDraft,
  Entry,
  Hello,
  HostEvent,
  LibraryItem,
  ScreenState,
  Usage,
} from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import { toBase64 } from './bytes'
import { demoDirListing } from './mock-dirs'
import { MockRemote } from './mock-remote'
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
  /** 已上传文件（uploadId → 附件元数据），供 send 的 attachments 回显。 */
  private uploaded = new Map<string, Attachment>()
  private botSeq = 0
  /** 演示工件（readArtifact 按块截断，验证客户端分块组装）。 */
  private artifacts = new Map<string, Artifact>()
  private artifactBytes = new Map<string, Uint8Array>()
  /** Phase 3 终端（屏幕后续同入 mock-remote）：call 与流均由其接管。 */
  private readonly remote = new MockRemote()

  constructor(private readonly hostName = '演示主机') {}

  /** 演示文本工件：约 2.5KB 重复文本，mock 按 1KB/块返回，逼真分块读。 */
  private static demoArtifactText = Array.from(
    { length: 80 },
    (_, i) => `第 ${i + 1} 行：Codync Web 演示工件内容，用于分块读取与下载。`,
  ).join('\n')

  private demoArtifact(botId: string): Artifact {
    const bytes = new TextEncoder().encode(MockTransport.demoArtifactText)
    const existing = [...this.artifacts.values()].find((a) => a.botId === botId)
    if (existing) return existing
    const artifact: Artifact = {
      id: `art-${botId}`,
      botId,
      title: '演示报告.md',
      size: bytes.length,
      sha256: 'demo',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rev: ++this.rev,
    }
    this.artifacts.set(artifact.id, artifact)
    this.artifactBytes.set(artifact.id, bytes)
    return artifact
  }

  /** 主机删除事件的精确形状：bot 对象只带 {id, deleted: true, rev}（hub.rs:294）。 */
  private emitBotDeleted(id: string) {
    this.rev += 1
    this.emit({ type: 'bot', rev: this.rev, bot: { id, deleted: true, rev: this.rev } as unknown as Bot })
  }

  private emitBot(bot: Bot) {
    bot.rev = ++this.rev
    this.emit({ type: 'bot', rev: bot.rev, bot })
  }

  private entry(botId: string, kind: string, data: Record<string, unknown>): Entry {
    this.seq += 1
    this.rev += 1
    return {
      id: `e${this.seq}`,
      seq: this.seq,
      botId,
      rev: this.rev,
      kind,
      turn: 1,
      data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
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
          backends: [
            {
              id: 'claude-code',
              name: 'Claude Code',
              available: true,
              command: 'claude',
              installHint: '',
              curated: true,
              installed: true,
              signedIn: true,
            },
            {
              id: 'codex',
              name: 'Codex',
              available: true,
              command: 'codex',
              installHint: '',
              curated: true,
              installed: true,
              signedIn: false,
            },
          ],
          rev: this.rev,
        }
        return hello as T
      }
      case 'history': {
        const botId = String(b.botId)
        const before = typeof b.beforeSeq === 'number' ? b.beforeSeq : Number.MAX_SAFE_INTEGER
        const limit = typeof b.limit === 'number' ? Math.min(Math.max(b.limit, 1), 500) : 100
        const list = (this.entries.get(botId) ?? []).filter((e) => e.seq < before).slice(-limit)
        return { entries: list } as T
      }
      case 'send': {
        const botId = String(b.botId)
        // 主机会把 clientNonce / replyTo / attachments 原样记入 user entry（api/bots.rs:160-179），
        // 客户端按 clientNonce 替换本地占位条目——mock 必须回显，否则乐观更新无法收敛。
        const userEntry = this.entry(botId, 'user', {
          text: String(b.text ?? ''),
          clientNonce: b.clientNonce,
          ...(b.replyTo ? { replyTo: b.replyTo } : {}),
          ...(Array.isArray(b.attachments) && b.attachments.length
            ? {
                attachments: (b.attachments as string[]).map(
                  (id) => this.uploaded.get(id) ?? { id, name: `file-${String(id).slice(0, 6)}`, size: 1024 },
                ),
              }
            : {}),
          status: 'sent',
        })
        this.push(userEntry)
        const reply = this.entry(botId, 'agent', { text: `（演示模式回声）收到：${String(b.text ?? '')}`, final: true })
        this.push(reply)
        return { entry: userEntry } as T
      }
      case 'upload': {
        const upload = b as { uploadId: string; name: string }
        this.uploaded.set(upload.uploadId, { id: upload.uploadId, name: upload.name, size: 1024 })
        return { attachment: this.uploaded.get(upload.uploadId) } as T
      }
      case 'readUpload':
      case 'readFile': {
        // 演示字节：1KB 的占位内容（不还原真实文件）。
        return { data: toBase64(new Uint8Array(1024).fill(65)), size: 1024 } as T
      }
      case 'respondPermission':
        return {} as T
      case 'markRead': {
        const botId = String(b.botId)
        const index = this.bots.findIndex((x) => x.id === botId)
        if (index >= 0) this.bots[index] = normalizeBot({ ...this.bots[index], unread: 0 })
        return {} as T
      }
      case 'createBot': {
        // 与主机同语义（hub/order.rs:29-34）：roster 已被用户排过序时新 Bot 置顶（min-1），否则 0。
        const draft = b as unknown as BotDraft
        const id = `bot-mock-${++this.botSeq}`
        const positions = this.bots.map((x) => x.position)
        const arranged = positions.some((p) => p !== 0)
        const position = arranged ? Math.min(...positions) - 1 : 0
        const bot = normalizeBot({
          id,
          name: draft.name ?? '',
          description: draft.description ?? '',
          avatarColor: draft.avatarColor ?? 'blue',
          avatarShape: draft.avatarShape ?? 'blob',
          backend: draft.backend ?? 'custom',
          command: draft.command ?? null,
          cwd: draft.cwd ?? '',
          permission: draft.permission ?? 'ask',
          model: draft.model ?? null,
          section: draft.section ?? undefined,
          position,
          rev: ++this.rev,
          status: 'idle',
          unread: 0,
        })
        this.bots.push(bot)
        this.emitBot(bot)
        return { bot } as T
      }
      case 'updateBot': {
        // id 必填（hub.rs:251）；draft 里 undefined 的字段主机保持不变，null/'' 清除。
        const draft = b as unknown as BotDraft
        const index = this.bots.findIndex((x) => x.id === draft.id)
        if (index < 0) throw new HostError(404, 'unknown bot')
        const current = this.bots[index]!
        const kept = <K extends keyof BotDraft>(key: K): BotDraft[K] => draft[key]
        const patch: Partial<Bot> = {}
        const name = kept('name')
        if (name !== undefined) patch.name = name
        const description = kept('description')
        if (description !== undefined) patch.description = description
        const avatarColor = kept('avatarColor')
        if (avatarColor !== undefined) patch.avatarColor = avatarColor
        const avatarShape = kept('avatarShape')
        if (avatarShape !== undefined) patch.avatarShape = avatarShape
        const backend = kept('backend')
        if (backend !== undefined) patch.backend = backend
        const command = kept('command')
        if (command !== undefined) patch.command = command
        const cwd = kept('cwd')
        if (cwd !== undefined) patch.cwd = cwd
        const permission = kept('permission')
        if (permission !== undefined) patch.permission = permission
        const model = kept('model')
        if (model !== undefined) patch.model = model
        const section = kept('section')
        if (section !== undefined) patch.section = section ?? undefined
        const pinned = kept('pinned')
        if (pinned !== undefined) patch.pinned = pinned
        const hidden = kept('hidden')
        if (hidden !== undefined) patch.hidden = hidden
        const bot = normalizeBot({ ...current, ...patch })
        this.bots[index] = bot
        this.emitBot(bot)
        return { bot } as T
      }
      case 'deleteBot': {
        const botId = String(b.botId)
        if (!this.bots.some((x) => x.id === botId)) throw new HostError(404, 'unknown bot')
        this.bots = this.bots.filter((x) => x.id !== botId)
        this.emitBotDeleted(botId)
        return {} as T
      }
      case 'reorderBots': {
        // 主机语义（hub/order.rs:9-27）：ids 按序赋 position；未知/已删跳过；未列出的（隐藏）保持原位。
        const ids = (b as { ids: string[] }).ids ?? []
        const byId = new Map(this.bots.map((x) => [x.id, x]))
        ids.forEach((id, index) => {
          const bot = byId.get(id)
          if (!bot || bot.position === index) return
          bot.position = index
          this.emitBot(bot)
        })
        return {} as T
      }
      case 'renameSection': {
        // from → to（to 为 null/'' 清空该 section）；逐个发 bot 事件（bots.rs:105）。
        const from = String(b.from ?? '')
        const to = b.to == null || b.to === '' ? null : String(b.to)
        for (const bot of this.bots.filter((x) => x.section === from)) {
          const index = this.bots.findIndex((x) => x.id === bot.id)
          this.bots[index] = normalizeBot({ ...bot, section: to ?? undefined })
          this.emitBot(this.bots[index]!)
        }
        return {} as T
      }
      case 'listDirs': {
        const path = typeof b.path === 'string' ? b.path : ''
        return demoDirListing(path) as T
      }
      case 'usage': {
        const usage: Usage = {
          providers: [
            {
              id: 'claude',
              name: 'Claude',
              source: 'demo',
              updatedAt: Date.now(),
              windows: [
                { id: 'session', label: '当前会话', percent: 18 },
                {
                  id: 'week',
                  label: '本周（全模型）',
                  percent: 42,
                  resetsAt: Date.now() + 86400000,
                  resetsText: '1 天后重置',
                },
                { id: 'opus', label: '本周（Opus）', percent: 7, text: '0.9M / 11M tokens' },
              ],
            },
          ],
        }
        return usage as T
      }
      case 'library': {
        const botId = String(b.botId)
        const artifact = this.demoArtifact(botId)
        const items: LibraryItem[] = [{ kind: 'artifact', at: artifact.updatedAt, artifact }]
        return { items } as T
      }
      case 'readArtifact': {
        const botId = String(b.botId)
        const artifactId = String(b.artifactId)
        const bytes = this.artifactBytes.get(artifactId)
        if (!bytes) throw new HostError(404, 'unknown artifact')
        const offset = typeof b.offset === 'number' ? Math.max(b.offset, 0) : 0
        // 与真实主机一致：按块返回（这里 1KB/块，逼客户端分块循环）。
        const end = Math.min(offset + 1024, bytes.length)
        const artifact = this.demoArtifact(botId)
        return { data: toBase64(bytes.subarray(offset, end)), size: bytes.length, artifact } as T
      }
      case 'renameArtifact': {
        const artifactId = String(b.artifactId)
        const artifact = this.artifacts.get(artifactId)
        if (!artifact) throw new HostError(404, 'unknown artifact')
        const renamed: Artifact = {
          ...artifact,
          title: String(b.title ?? artifact.title),
          updatedAt: Date.now(),
          rev: ++this.rev,
        }
        this.artifacts.set(artifactId, renamed)
        this.emit({ type: 'artifact', rev: renamed.rev, artifact: renamed })
        return { artifact: renamed } as T
      }
      case 'agentSetup':
      case 'termInput':
      case 'termResize':
      case 'termClose':
      case 'screenPrepare':
      case 'screenOffer':
      case 'screenCandidate':
      case 'screenClose':
        return this.remote.call<T>(method, b)
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
    if (path.startsWith('/events')) {
      this.eventSink = onData
      queueMicrotask(() => {
        onData({
          type: 'hello',
          hostId: 'mock-host',
          computerId: 'mock',
          rev: this.rev,
          usage: { providers: [] },
          screen: MockTransport.mockScreen,
          network: null,
          catchUp: this.bots.length,
        } satisfies HostEvent)
        for (const bot of this.bots) onData({ type: 'bot', rev: bot.rev, bot } satisfies HostEvent)
        // 一张待审批的权限卡：让演示模式覆盖 PermissionCard 的完整交互（回应走 respondPermission）。
        const ask = this.entry('bot-claude', 'permission', {
          status: 'pending',
          toolKind: 'execute',
          title: 'npm install --save-dev vitest',
          command: 'npm install --save-dev vitest',
          cwd: '~/demo',
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
          ],
        })
        this.push(ask)
      })
      return () => {
        this.eventSink = null
        onEnd(null)
      }
    }
    if (path.startsWith('/term/')) return this.remote.termStream(path, onData, onEnd)
    if (path.startsWith('/screen-candidates')) return this.remote.screenStream(path, onData, onEnd)
    onEnd(new HostError(404, `演示模式未实现流：${path}`))
    return () => {}
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
