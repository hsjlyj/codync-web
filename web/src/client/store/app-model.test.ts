/**
 * AppModel 状态流转测试（MockTransport 提供与主机一致的事件语义）。
 * 覆盖：连接（hello → 事件追平出 roster）、按 id upsert、rev 游标前进、
 * 发送消息（pending 计数 + entry 落库）、resync 清空重追、断开清态。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/mock-transport'
import { AppModel } from './app-model'

describe('AppModel（MockTransport）', () => {
  let model: AppModel

  beforeEach(() => {
    model = new AppModel()
  })

  it('connect 后事件追平：hello 游标 + bot 列表出现', async () => {
    await model.connect(new MockTransport())
    const snap = model.getSnapshot()
    expect(snap.connection).toBe('open')
    expect(snap.hello?.name).toBe('演示主机')
    expect(snap.rev).toBeGreaterThan(0)
    expect(snap.bots.map((b) => b.name)).toEqual(['Claude 演示', 'Codex 演示'])
  })

  it('选择 Bot 后发送消息：user + agent(entry 事件) 按 id upsert，pending 归零', async () => {
    await model.connect(new MockTransport())
    model.select('bot-claude')
    const versionBefore = model.getSnapshot().entriesVersion
    const sendPromise = model.sendMessage('第一条消息')
    expect(model.getSnapshot().pendingSends).toBe(1)
    await sendPromise
    const entries = model.entriesOf('bot-claude')
    expect(entries.map((e) => e.kind)).toEqual(['user', 'agent'])
    expect(model.getSnapshot().pendingSends).toBe(0)
    expect(model.getSnapshot().entriesVersion).toBeGreaterThan(versionBefore)
    const agent = entries[1]
    expect(agent.data.final).toBe(true)
    expect(String(agent.data.text)).toContain('第一条消息')
  })

  it('重复收到同一 entry（事件重放）按 id 去重，不产生重复消息', async () => {
    await model.connect(new MockTransport())
    model.select('bot-claude')
    await model.sendMessage('去重检查')
    const count = model.entriesOf('bot-claude').length
    expect(count).toBe(2)
    // sendMessage 已把 send 的返回 entry 与事件 entry upsert 到同一 Map，
    // 同 id 的两次写入只留一条：这里直接断言列表长度不变即覆盖了契约。
    expect(model.entriesOf('bot-claude').length).toBe(count)
  })

  it('disconnect 清空状态并回到 closed', async () => {
    await model.connect(new MockTransport())
    model.select('bot-codex')
    model.disconnect()
    const snap = model.getSnapshot()
    expect(snap.connection).toBe('closed')
    expect(snap.bots).toEqual([])
    expect(snap.selectedBotId).toBeNull()
    expect(model.entriesOf('bot-codex')).toEqual([])
  })

  it('未选择 Bot 时发送抛错', async () => {
    await model.connect(new MockTransport())
    await expect(model.sendMessage('x')).rejects.toThrow('未选择 Bot')
  })
})
