/**
 * BotState —— 花名册域状态（自 app-model 纯搬移，不改逻辑）：
 * bot 事件按 id upsert、删除事件（只带 {id, deleted:true, rev}，hub.rs:294）收窄、
 * position 排序。宿主能力（rev 游标与快照通知）经 BotHost 注入。
 */
import type { Bot, HostEvent } from '@codync/shared'
import { normalizeBot } from '@codync/shared'
import type { AppSnapshot } from './snapshot'

export interface BotHost {
  /** 当前全局 rev 游标（事件 rev 取 max）。 */
  rev(): number
  /** 合并 patch 进快照并通知订阅者（AppModel.changed 的原语义）。 */
  emit(patch: Partial<AppSnapshot>): void
}

export class BotState {
  private byId = new Map<string, Bot>()

  constructor(private readonly host: BotHost) {}

  /** 应用一个 bot 事件（AppModel.applyEvent 的 bot 分支）。 */
  applyBotEvent(event: Extract<HostEvent, { type: 'bot' }>) {
    // 主机删除 Bot 的 bot 事件只带 {id, deleted: true, rev}（hub.rs:294）——按事件收窄，
    // 不能进 upsert，否则 normalizeBot 会造出一个名为 "Bot" 的幽灵条目。
    if ((event.bot as { deleted?: boolean }).deleted === true) {
      this.byId.delete(event.bot.id)
      this.host.emit({ bots: this.sorted(), rev: Math.max(this.host.rev(), event.rev) })
      return
    }
    const bot = normalizeBot(event.bot as Partial<Bot> & { id: string })
    this.byId.set(bot.id, bot)
    this.host.emit({ bots: this.sorted(), rev: Math.max(this.host.rev(), event.rev) })
  }

  byIdOf(botId: string): Bot | null {
    return this.byId.get(botId) ?? null
  }

  /** 断开/resync 时清空花名册。 */
  clear() {
    this.byId.clear()
  }

  private sorted(): Bot[] {
    return [...this.byId.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
  }
}
