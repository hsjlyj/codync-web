/**
 * EntryState —— 会话条目域状态（自 app-model 纯搬移，不改逻辑）：
 * 按 botId 分桶的 entry 存储、乐观发送（clientNonce 占位→主机确认替换）、
 * 历史分页（beforeSeq 游标 + 到底判定）、分块上传与整段读回。
 * 宿主能力（transport/快照）经 EntryHost 注入，本类不持连接、不持订阅者。
 */
import type { Attachment, Entry } from '@codync/shared'
import { quoteOf } from '@codync/shared'
import { MAX_FILE_SIZE, UPLOAD_CHUNK, chunkRanges, fromBase64, toBase64 } from '../transport/bytes'
import type { HostTransport } from '../transport/host-transport'
import type { AppSnapshot } from './snapshot'

/** 宿主能力：EntryState 只能透过它触达传输与快照。 */
export interface EntryHost {
  transport(): HostTransport | null
  selectedBotId(): string | null
  entriesVersion(): number
  /** 合并 patch 进快照并通知订阅者（AppModel.changed 的原语义）。 */
  emit(patch: Partial<AppSnapshot>): void
}

export class EntryState {
  private byBot = new Map<string, Map<string, Entry>>()
  private exhausted = new Map<string, boolean>()
  private sending = 0

  constructor(private readonly host: EntryHost) {}

  // MARK: 查询

  entriesOf(botId: string | null): Entry[] {
    if (!botId) return []
    const map = this.byBot.get(botId)
    if (!map) return []
    return [...map.values()].sort((a, b) => a.seq - b.seq)
  }

  /** 该 Bot 的历史是否已翻到底（「加载更早」按钮的显隐）。 */
  historyExhaustedOf(botId: string): boolean {
    return this.exhausted.get(botId) ?? false
  }

  /** 当前已加载的最旧 seq（翻页游标）；无条目返回 null。 */
  oldestSeqOf(botId: string): number | null {
    const first = this.entriesOf(botId)[0]
    return first ? first.seq : null
  }

  // MARK: 事件写入

  /** 按 id upsert（不 bump 计数——调用方负责 entriesVersion）；同 clientNonce 的
   *  本地占位条目被主机确认（send 返回或 events 推送）时移除，避免短暂双份。 */
  upsert(entry: Entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.botId !== 'string') return
    const map = this.byBot.get(entry.botId) ?? new Map<string, Entry>()
    const nonce = entry.data?.clientNonce
    if (nonce) {
      for (const [id, local] of map) {
        if (id.startsWith('local-') && local.data.clientNonce === nonce) map.delete(id)
      }
    }
    map.set(entry.id, { ...entry, data: entry.data ?? {} })
    this.byBot.set(entry.botId, map)
  }

  /** 断开/resync 时清空全部条目域状态。 */
  clear() {
    this.byBot.clear()
    this.exhausted.clear()
    this.sending = 0
  }

  // MARK: 发送（乐观更新：本地先显示，主机确认后按 clientNonce 替换）

  async sendMessage(text: string, opts?: { replyTo?: string; attachments?: Attachment[] }): Promise<void> {
    const botId = this.host.selectedBotId()
    const transport = this.host.transport()
    if (!botId || !transport) throw new Error('未选择 Bot 或未连接主机')
    const nonce = randomNonce()
    this.upsertLocal(botId, nonce, text, opts?.replyTo, opts?.attachments)
    this.sending += 1
    this.host.emit({ pendingSends: this.sending })
    try {
      const { entry } = await transport.call<{ entry: Entry }>('send', {
        botId,
        text,
        clientNonce: nonce,
        replyTo: opts?.replyTo,
        attachments: opts?.attachments?.map((a) => a.id),
      })
      this.upsert(entry)
      this.host.emit({ entriesVersion: this.host.entriesVersion() + 1 })
    } catch (e) {
      this.markLocalFailed(botId, nonce)
      throw e
    } finally {
      this.sending -= 1
      this.host.emit({ pendingSends: this.sending })
    }
  }

  /** 移除发送失败的本地占位条目（重试即重新发送一条新消息）。 */
  discardLocal(entryId: string) {
    for (const [botId, map] of this.byBot) {
      if (!map.has(entryId)) continue
      map.delete(entryId)
      this.byBot.set(botId, map)
      this.host.emit({ entriesVersion: this.host.entriesVersion() + 1 })
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
    this.upsert(local)
    this.host.emit({ entriesVersion: this.host.entriesVersion() + 1 })
  }

  private markLocalFailed(botId: string, nonce: string) {
    const map = this.byBot.get(botId)
    const local = map?.get(`local-${nonce}`)
    if (!map || !local) return
    map.set(local.id, { ...local, data: { ...local.data, status: 'failed' } })
    this.byBot.set(botId, map)
    this.host.emit({ entriesVersion: this.host.entriesVersion() + 1 })
  }

  // MARK: 文件上传（分块 base64，主机 `upload` 追加，uploadId 即附件 id）

  /** 逐块上传一组文件；onProgress 汇报全局 (已完成块, 总块数)。 */
  async uploadFiles(
    botId: string,
    files: File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Attachment[]> {
    const transport = this.host.transport()
    if (!transport) throw new Error('未连接主机')
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
        await transport.call('upload', {
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
    const transport = this.host.transport()
    if (!transport) throw new Error('未连接主机')
    const { entries } = await transport.call<{ entries: Entry[] }>('history', { botId, beforeSeq, limit })
    for (const entry of entries) this.upsert(entry)
    this.exhausted.set(botId, entries.length < limit)
    this.host.emit({ entriesVersion: this.host.entriesVersion() + 1 })
  }

  // MARK: 文件下载（图片内联预览与文件卡片的字节来源）

  /** 整段读回一个上传文件（384KB 分块循环，主机 `readUpload`）。 */
  async readUploadBytes(botId: string, uploadId: string): Promise<Uint8Array> {
    const transport = this.host.transport()
    if (!transport) throw new Error('未连接主机')
    const maxChunks = Math.ceil(MAX_FILE_SIZE / UPLOAD_CHUNK) + 8
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const res = await transport.call<{ data: string; size: number }>('readUpload', {
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
    const transport = this.host.transport()
    if (!transport) throw new Error('未连接主机')
    const maxChunks = Math.ceil(MAX_FILE_SIZE / UPLOAD_CHUNK) + 8
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const res = await transport.call<{ data: string; size: number }>('readFile', {
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
