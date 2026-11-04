/**
 * BotAdmin 编排测试（Phase 2，MockTransport 提供与主机一致的方法语义）：
 * CRUD 的载荷形状（updateBot id 必填、deleteBot 收 {botId}）、roster 由 bot 事件推进
 * （删除事件只带 {id, deleted:true, rev}）、reorderBots 的 position 语义、
 * renameSection 的改名与清空、listDirs 透传、未连接守卫。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { BotDraft } from '@codync/shared'
import { draftOf } from '@codync/shared'
import { MockTransport } from '../transport/mock-transport'
import { AppModel } from './app-model'
import { BotAdmin } from './bot-admin'

const baseDraft: BotDraft = {
  name: '新测试机',
  description: '测试用',
  avatarColor: 'blue',
  avatarShape: 'blob',
  backend: 'claude-code',
  cwd: '',
  permission: 'ask',
}

describe('BotAdmin（MockTransport）', () => {
  let model: AppModel
  let admin: BotAdmin

  beforeEach(async () => {
    model = new AppModel()
    admin = model.admin
    await model.connect(new MockTransport())
  })

  const botOf = (id: string) => model.getSnapshot().bots.find((b) => b.id === id)

  it('未连接时所有方法拒绝（I/O 在 store 层兜底）', async () => {
    const disconnected = new AppModel().admin
    await expect(disconnected.createBot(baseDraft)).rejects.toThrow('未连接主机')
    await expect(disconnected.listDirs()).rejects.toThrow('未连接主机')
  })

  it('createBot：返回 Bot，roster 由 bot 事件推进（不依赖返回值）', async () => {
    const bot = await admin.createBot(baseDraft)
    expect(bot.id).toMatch(/^bot-mock-/)
    expect(bot.name).toBe('新测试机')
    // 事件已回声（connect 后事件通道已建立，emit 同步进 sink）。
    expect(botOf(bot.id)?.name).toBe('新测试机')
  })

  it('updateBot 缺 id 直接拒绝（hub.rs:251 主机必填）', async () => {
    await expect(admin.updateBot(baseDraft)).rejects.toThrow('缺少 Bot id')
  })

  it('updateBot 补丁字段生效；section 走同一补丁（无独立 setBotSection）', async () => {
    const bot = await admin.createBot(baseDraft)
    await admin.updateBot({ ...draftOf(bot), section: 'Work', model: 'claude-sonnet-4-5' })
    const after = botOf(bot.id)
    expect(after?.section).toBe('Work')
    expect(after?.model).toBe('claude-sonnet-4-5')
  })

  it('moveBotToSection 移入与移出（null）', async () => {
    const bot = await admin.createBot(baseDraft)
    await admin.moveBotToSection(bot, 'Work')
    expect(botOf(bot.id)?.section).toBe('Work')
    const moved = botOf(bot.id)!
    await admin.moveBotToSection(moved, null)
    expect(botOf(bot.id)?.section).toBeUndefined()
  })

  it('reorderBots：按 ids 顺序赋 position（主机语义，未列出者保持原位）', async () => {
    const bot = await admin.createBot(baseDraft)
    const ids = ['bot-codex', 'bot-claude', bot.id]
    await admin.reorderBots(ids)
    const positions = ids.map((id) => botOf(id)?.position)
    expect(positions[0]).toBeLessThan(positions[1]!)
    expect(positions[1]).toBeLessThan(positions[2]!)
    // roster 顺序随事件重排（AppModel.sortedBots 按 position）。
    expect(model.getSnapshot().bots.map((b) => b.id)).toEqual(ids)
  })

  it('renameSection：改组名与清空（null）', async () => {
    const bot = await admin.createBot(baseDraft)
    await admin.moveBotToSection(bot, 'Work')
    await admin.renameSection('Work', 'Project')
    expect(botOf(bot.id)?.section).toBe('Project')
    await admin.renameSection('Project', null)
    expect(botOf(bot.id)?.section).toBeUndefined()
  })

  it('deleteBot：载荷是 {botId}；roster 由 deleted:true 的 bot 事件收窄（hub.rs:294）', async () => {
    const bot = await admin.createBot(baseDraft)
    expect(botOf(bot.id)).toBeDefined()
    await admin.deleteBot(bot.id)
    expect(botOf(bot.id)).toBeUndefined()
    // 删除事件的 bot 对象没有其他字段，不能被当成新条目 upsert。
    expect(model.getSnapshot().bots.every((b) => b.name !== 'Bot')).toBe(true)
  })

  it('listDirs：目录树逐级浏览', async () => {
    const root = await admin.listDirs()
    expect(root.recent?.length).toBeGreaterThan(0)
    const projects = await admin.listDirs('~/projects')
    expect(projects.path).toBe('~/projects')
    expect(projects.dirs[0]?.name).toBe('codync-web')
    expect(projects.dirs[0]?.isGit).toBe(true)
  })
})
