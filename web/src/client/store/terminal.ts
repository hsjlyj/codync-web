/**
 * 终端会话编排（Phase 3）：`agentSetup` 创建 → `/term/<id>` 订阅 → 输入/尺寸/关闭。
 * I/O 全部在此；视图（xterm.js）只渲染与转发事件。事件形状（砚台 dbcf53d）：
 * `{"type":"output","data":<base64>}`、`{"type":"exit","code":n}`；termInput 走普通请求
 * （tui/net.rs:173 同款），退出后订阅由主机收尾（`{"id","end":true}`）。
 */
import type { TermEvent } from '@codync/shared'
import { fromBase64 } from '../transport/bytes'
import type { HostTransport } from '../transport/host-transport'

export type TerminalStage = 'starting' | 'running' | 'exited' | 'failed'

export interface TerminalHandlers {
  /** 解码后的终端输出（UTF-8），视图写入 xterm。 */
  onOutput: (chunk: string) => void
  onStage: (stage: TerminalStage, detail?: string) => void
}

export interface TerminalStartParams {
  backend: string
  step: 'install' | 'login'
  cols?: number
  rows?: number
}

export class TerminalController {
  private termId: string | null = null
  private stopStream: (() => void) | null = null
  private starting = false
  private exited = false
  /** 输入微批：同步连击合并为一次 termInput（queueMicrotask 无定时器，测试可确定性冲刷）。 */
  private pendingInput: string[] = []
  private flushingInput = false
  /** UTF-8 流式解码器：output 块可能切在多字节字符中间（见 onTermEvent），跨会话不复用残留。 */
  private decoder = new TextDecoder()

  constructor(
    private readonly transport: HostTransport,
    private readonly handlers: TerminalHandlers,
  ) {}

  /** 启动会话；幂等（React StrictMode 双挂载 / 重试竞态下不会重复建终端）。 */
  async start(params: TerminalStartParams): Promise<void> {
    if (this.termId || this.starting) return
    this.starting = true
    this.exited = false
    this.decoder = new TextDecoder() // 新会话：丢弃上一条流可能留下的半字符
    this.handlers.onStage('starting')
    try {
      const reply = await this.transport.call<{ term: string }>('agentSetup', {
        step: params.step,
        backend: params.backend,
        ...(params.cols ? { cols: params.cols } : {}),
        ...(params.rows ? { rows: params.rows } : {}),
      })
      if (this.stopStream || this.exited) return // start 等待期间已被 stop() 收尾
      this.termId = reply.term
      this.stopStream = this.transport.stream(
        `/term/${reply.term}`,
        (raw) => this.onTermEvent(raw as TermEvent),
        (error) => this.onStreamEnd(error),
      )
      this.handlers.onStage('running')
    } catch (e) {
      this.handlers.onStage('failed', e instanceof Error ? e.message : String(e))
    } finally {
      this.starting = false
    }
  }

  /** 键入（xterm onData）：微批后作为 termInput 发送。 */
  write(data: string): void {
    if (!this.termId || this.exited) return
    this.pendingInput.push(data)
    if (this.flushingInput) return
    this.flushingInput = true
    queueMicrotask(() => {
      this.flushingInput = false
      const batched = this.pendingInput.join('')
      this.pendingInput = []
      if (!batched || !this.termId) return
      void this.transport.call('termInput', { term: this.termId, data: batched }).catch(() => {
        /* 链路瞬断由重连恢复；输出流的 end 分支会给出用户可见错误 */
      })
    })
  }

  resize(cols: number, rows: number): void {
    if (!this.termId || this.exited) return
    void this.transport.call('termResize', { term: this.termId, cols, rows }).catch(() => {})
  }

  /** 关闭会话：退订（发 cancel）+ termClose（主机杀进程 → exit 事件 → 流收尾）。幂等。 */
  stop(): void {
    this.pendingInput = []
    if (this.stopStream) {
      const stop = this.stopStream
      this.stopStream = null
      stop()
    }
    const termId = this.termId
    this.termId = null
    if (!termId || this.exited) return
    this.exited = true
    void this.transport
      .call('termClose', { term: termId })
      .catch(() => {})
      .finally(() => {
        if (this.termId === null) this.handlers.onStage('exited', 'code 0')
      })
  }

  private onTermEvent(event: TermEvent): void {
    if (event.type === 'output') {
      // 主机按读缓冲区切分输出，块边界会落在多字节字符（中文/emoji）中间：必须流式解码，
      // 否则每块各自解出 U+FFFD。不完整的前缀留在解码器里，等下一块或流结束时收尾。
      const text = this.decoder.decode(fromBase64(event.data), { stream: true })
      if (text) this.handlers.onOutput(text)
    } else if (event.type === 'exit') {
      this.exited = true
      this.termId = null
      this.stopStream = null
      this.flushDecoder()
      this.handlers.onStage('exited', `code ${event.code}`)
    }
  }

  /** 流收尾：放出解码器里挂起的半字符（残缺序列即 U+FFFD），不静默丢字节。幂等。 */
  private flushDecoder(): void {
    const rest = this.decoder.decode()
    if (rest) this.handlers.onOutput(rest)
  }

  private onStreamEnd(error: { message: string } | null): void {
    this.flushDecoder() // exit 路径已收尾过（此时为空）；意外断开时也把残字节放出
    if (this.exited) return // 正常收尾（exit 后主机 end:true）
    this.exited = true
    this.termId = null
    this.handlers.onStage('failed', error?.message ?? '终端流已断开')
  }
}
