/**
 * BotAdmin —— Bot 增删改查与分组排序的 store 层编排（Phase 2）。
 * I/O 全部在此（视图不持有 I/O）：经 AppModel 的加密通道调用主机方法。
 * 主机方法事实（砚台 06c8e3c + 本轮源码核实）：
 * - 排序：`reorderBots({ids})`（roster 整体拖拽顺序，bots.rs:96）；
 * - 分组：`updateBot` 补丁的 `BotDraft.section`（放入/移出 section，id 必填 hub.rs:251），
 *   `renameSection({from,to})` 重命名或清空一个 section（to=null；bots.rs:105）；
 * - 删除：`deleteBot({botId})`（不是 {id}），roster 由 deleted:true 的 bot 事件收窄；
 * - 目录浏览：`listDirs({path?})` → DirListing；
 * - 主机没有 `setBotPosition`/`setBotSection`/`setBotPinned`/`setBotHidden`/消息 `search` 方法。
 */
import type { Bot, BotDraft, DirListing } from '@codync/shared'
import { draftOf } from '@codync/shared'
import type { AppModel } from './app-model'

export class BotAdmin {
  constructor(private readonly appModel: AppModel) {}

  private requireOnline() {
    if (this.appModel.getSnapshot().connection !== 'open') throw new Error('未连接主机')
  }

  /** 新建 Bot（空 name 由主机在首次对话后命名，桌面端同语义）；成功后 roster 由 bot 事件推进。 */
  async createBot(draft: BotDraft): Promise<Bot> {
    this.requireOnline()
    const { bot } = await this.appModel.call<{ bot: Bot }>('createBot', draft)
    return bot
  }

  async updateBot(draft: BotDraft): Promise<Bot> {
    this.requireOnline()
    if (!draft.id) throw new Error('缺少 Bot id（updateBot 必填，hub.rs:251）')
    const { bot } = await this.appModel.call<{ bot: Bot }>('updateBot', draft)
    return bot
  }

  /** 删除 Bot（主机软删）；roster 由 deleted:true 的 bot 事件收窄。 */
  async deleteBot(botId: string): Promise<void> {
    this.requireOnline()
    await this.appModel.call('deleteBot', { botId })
  }

  /** 拖拽排序：按新顺序提交整张 roster 的 id 序列。 */
  async reorderBots(ids: string[]): Promise<void> {
    this.requireOnline()
    await this.appModel.call('reorderBots', { ids })
  }

  /** 把一个 Bot 移入 section（null 移出）；走 updateBot 补丁的 section 字段。 */
  async moveBotToSection(bot: Bot, section: string | null): Promise<void> {
    await this.updateBot({ ...draftOf(bot), section })
  }

  /** 重命名（或清空，to=null）一个 section 的全部 Bot。 */
  async renameSection(from: string, to: string | null): Promise<void> {
    this.requireOnline()
    await this.appModel.call('renameSection', { from, to })
  }

  /** 浏览主机目录（文件夹选择）。 */
  async listDirs(path?: string): Promise<DirListing> {
    this.requireOnline()
    return this.appModel.call<DirListing>('listDirs', { path })
  }
}

export { draftOf }
