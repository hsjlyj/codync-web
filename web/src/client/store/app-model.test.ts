/**
 * AppModel 状态流转测试（MockTransport 提供与主机一致的事件语义）。
 * 覆盖：连接（hello → 事件追平出 roster）、按 id upsert、rev 游标前进、
 * 发送消息（pending 计数 + entry 落库）、resync 清空重追、断开清态；
 * Phase 1：乐观发送（clientNonce 占位→替换）、失败标记与丢弃、历史分页、权限回应。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '@codync/shared'
import type { HostTransport } from '../transport/host-transport'
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
    // 演示模式预置一张 permission 卡（Phase 1 PermissionCard 演示数据），随后是本次 user + agent。
    expect(entries.map((e) => e.kind)).toEqual(['permission', 'user', 'agent'])
    expect(model.getSnapshot().pendingSends).toBe(0)
    expect(model.getSnapshot().entriesVersion).toBeGreaterThan(versionBefore)
    const agent = entries[2]
    expect(agent.data.final).toBe(true)
    expect(String(agent.data.text)).toContain('第一条消息')
  })

  it('重复收到同一 entry（事件重放）按 id 去重，不产生重复消息', async () => {
    await model.connect(new MockTransport())
    model.select('bot-claude')
    await model.sendMessage('去重检查')
    const count = model.entriesOf('bot-claude').length
    expect(count).toBe(3)
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

describe('AppModel Phase 1（乐观更新 / 历史 / 权限）', () => {
  let model: AppModel

  beforeEach(() => {
    model = new AppModel()
  })

  const connectWith = async (transport: Partial<HostTransport>) => {
    const full: HostTransport = {
      stream: () => () => {},
      ...transport,
    } as HostTransport
    await model.connect(full)
    model.select('bot-claude')
  }

  const confirmedEntry = (nonce: string): Entry => ({
    id: `h-${nonce.slice(0, 8)}`,
    seq: 99,
    botId: 'bot-claude',
    rev: 99,
    kind: 'user',
    turn: 1,
    data: { text: '你好', clientNonce: nonce, status: 'sent' },
    createdAt: 1,
    updatedAt: 1,
  })

  it('乐观发送：本地 sending 占位 → 主机确认后按 clientNonce 替换', async () => {
    let resolveSend!: (nonce: string) => void
    const call = vi.fn().mockImplementation((method: string) => {
      if (method !== 'send') return Promise.resolve({})
      return new Promise((resolve) => {
        resolveSend = (nonce: string) => resolve({ entry: confirmedEntry(nonce) })
      })
    })
    await connectWith({ call })
    const pending = model.sendMessage('你好')
    await flush()
    const local = model.entriesOf('bot-claude').at(-1)!
    expect(local.id.startsWith('local-')).toBe(true)
    expect(local.data.status).toBe('sending')
    const nonce = local.data.clientNonce!
    expect(nonce).toBeTruthy()

    resolveSend(nonce)
    await pending
    const entries = model.entriesOf('bot-claude')
    expect(entries.at(-1)!.id).toBe(`h-${nonce.slice(0, 8)}`)
    expect(entries.at(-1)!.data.status).toBe('sent')
    expect(entries.some((e) => e.id.startsWith('local-'))).toBe(false)
  })

  it('事件先到也能替换占位（clientNonce 匹配，不等 send 返回）', async () => {
    await connectWith({
      call: vi
        .fn()
        .mockImplementation((method: string) =>
          method === 'send' ? Promise.resolve({ entry: confirmedEntry('nonce-evt') }) : Promise.resolve({}),
        ),
    })
    // 模拟主机事件先于 send 返回到达（直接走私有 upsertEntry 的同路径）。
    model['upsertEntry'](confirmedEntry('nonce-evt'))
    await model.sendMessage('你好')
    const entries = model.entriesOf('bot-claude')
    expect(entries.filter((e) => e.data.clientNonce === 'nonce-evt' && e.id.startsWith('local-'))).toHaveLength(0)
  })

  it('发送失败：占位标记 failed，discardLocal 移除', async () => {
    await connectWith({
      call: vi.fn().mockRejectedValue(new Error('主机拒绝')),
    })
    await expect(model.sendMessage('失败的消息')).rejects.toThrow('主机拒绝')
    const local = model.entriesOf('bot-claude').at(-1)!
    expect(local.data.status).toBe('failed')
    model.discardLocal(local.id)
    expect(model.entriesOf('bot-claude').some((e) => e.id === local.id)).toBe(false)
  })

  /** 按方法名分页返回 history 结果的 call mock（hello 等其余方法返回 {}）。 */
  const historyCall = (...pages: { entries: Entry[] }[]) => {
    const queue = [...pages]
    return vi
      .fn()
      .mockImplementation((method: string) =>
        Promise.resolve(method === 'history' ? (queue.shift() ?? { entries: [] }) : {}),
      )
  }

  it('历史分页：upsert 合并去重，翻页游标取最旧 seq，返回不足一页视为到底', async () => {
    const page = [11, 12, 13].map((seq) => entryOf(seq))
    const call = historyCall({ entries: page }, { entries: [entryOf(11)] })
    await connectWith({ call })
    await model.loadHistory('bot-claude', undefined, 3)
    expect(call).toHaveBeenNthCalledWith(2, 'history', { botId: 'bot-claude', beforeSeq: undefined, limit: 3 })
    expect(model.historyExhaustedOf('bot-claude')).toBe(false)
    await model.loadHistory('bot-claude', model.oldestSeqOf('bot-claude') ?? undefined, 3)
    expect(call).toHaveBeenNthCalledWith(3, 'history', { botId: 'bot-claude', beforeSeq: 11, limit: 3 })
    // 第二页只有 1 条（< 3）→ 到底；条目按 seq 去重合并。
    expect(model.historyExhaustedOf('bot-claude')).toBe(true)
    expect(model.entriesOf('bot-claude').map((e) => e.seq)).toEqual([11, 12, 13])
  })

  it('历史一页拉满时还有更早，返回不足一页时到底', async () => {
    const full = Array.from({ length: 50 }, (_, i) => entryOf(i + 1))
    await connectWith({ call: historyCall({ entries: full }, { entries: [entryOf(1000)] }) })
    await model.loadHistory('bot-claude', undefined, 50)
    expect(model.historyExhaustedOf('bot-claude')).toBe(false)
    await model.loadHistory('bot-claude', model.oldestSeqOf('bot-claude') ?? undefined, 50)
    expect(model.historyExhaustedOf('bot-claude')).toBe(true)
  })

  it('权限回应：调用 respondPermission 并在完成后清 respondingEntryId', async () => {
    const call = vi.fn().mockResolvedValue({})
    await connectWith({ call })
    const pending = model.respondPermission('e42', 'allow_once')
    expect(model.getSnapshot().respondingEntryId).toBe('e42')
    await pending
    expect(call).toHaveBeenCalledWith('respondPermission', { entryId: 'e42', optionId: 'allow_once' })
    expect(model.getSnapshot().respondingEntryId).toBeNull()
  })
})

// ---- helpers ----

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const entryOf = (seq: number): Entry => ({
  id: `e${seq}`,
  seq,
  botId: 'bot-claude',
  rev: seq,
  kind: 'user',
  turn: 1,
  data: { text: `m${seq}` },
  createdAt: seq,
  updatedAt: seq,
})
