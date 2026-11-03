/**
 * 主机传输层抽象 —— 与桌面端 `apps/desktop/src/renderer/client/host-client.ts` 的
 * `HostTransport` 同构（call + stream 两个原语，岚序评审认可的复用点）。
 * Web 端实现：`ChannelTransport`（/channel E2E，ADR-001）与 `MockTransport`（Phase 0 演示）。
 */

export class HostError extends Error {
  constructor(
    /** 0 = 链路失败（可重试），其余为主机返回的状态码。 */
    readonly status: number,
    message: string,
  ) {
    super(message)
  }

  static unreachable(message = '连不上主机：请确认电脑开机在线，且地址正确。') {
    return new HostError(0, message)
  }

  /** 链路问题而非请求被拒：主机恢复后同样调用即可成功。 */
  get isTransient() {
    return this.status === 0
  }
}

export interface HostTransport {
  /** 一次 API 调用（`POST /api/<method>` 的 channel 封套），解析为主机 JSON 应答。 */
  call<T = unknown>(method: string, body?: unknown, timeoutMs?: number): Promise<T>
  /** 打开一条服务端推送流（如 /events）；每个元素是一条事件 JSON。返回退订函数。 */
  stream(path: string, onData: (event: unknown) => void, onEnd: (error: HostError | null) => void): () => void
}

/** 连接生命周期状态（ConnectionBadge / AppModel 驱动 UI 用）。 */
export type TransportStatus = 'idle' | 'connecting' | 'handshaking' | 'open' | 'reconnecting' | 'closed' | 'failed'

/** 重连决策（按 close code 分流，试金 QA 口径：4001→退避重试 3 次后转人工；4003/4410/4400→终止；4008→加倍退避；4011→立即重连）。 */
export type ClosePolicy =
  | { action: 'reconnect' }
  | { action: 'reconnect-slow' }
  | { action: 'retry-limited'; reason: string }
  | { action: 'stop'; reason: string }
