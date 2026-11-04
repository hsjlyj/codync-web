/**
 * 配对码 / 配对 URL 解析（Phase 1）。
 * 主机生成的配对 QR 内容（host/src/service/mod.rs pairing_url）：
 *   `codync://pair?v=3&name=&id=&sk=&bk=&code=&urls=...[&cloud=...]`（Dev 环境为 codync-dev://）
 * - `id`   computerId（16B base64url）——握手 hs1_input 的 cid；
 * - `sk`   主机 Ed25519 公钥——welcome 签名强校验（防中间人，砚边审计要求）；
 * - `code` 一次性配对码；
 * - `urls` 主机可达地址（逗号分隔，如 `http://192.168.1.5:19222`），取第一个换算成 ws(s)。
 * 短码（`shortCode`）需 Codync 云解析成完整 URL，Web 端 Phase 2 接入云登录后再支持。
 */

export interface ParsedPairing {
  name: string
  computerId: string
  signKey: string
  boxKey: string
  code: string
  urls: string[]
  cloud?: string
  dev: boolean
}

const SCHEMES = ['codync:', 'codync-dev:'] as const

/** 解析粘贴的配对 URL；不是合法配对链接返回 null。 */
export function parsePairingUrl(text: string): ParsedPairing | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!(SCHEMES as readonly string[]).includes(url.protocol)) return null
  if (url.host !== 'pair' || url.searchParams.get('v') !== '3') return null
  const id = url.searchParams.get('id')
  const sk = url.searchParams.get('sk')
  const code = url.searchParams.get('code')
  if (!id || !sk || !code) return null
  const cloud = url.searchParams.get('cloud') ?? undefined
  return {
    name: url.searchParams.get('name') ?? '',
    computerId: id,
    signKey: sk,
    boxKey: url.searchParams.get('bk') ?? '',
    code,
    urls: (url.searchParams.get('urls') ?? '').split(',').filter(Boolean),
    cloud,
    dev: url.protocol === 'codync-dev:',
  }
}

/** 主机地址 → `/channel` WebSocket 地址：http→ws、https→wss，缺 path 时补 `/channel`。 */
export function channelUrlOf(hostUrl: string): string {
  const trimmed = hostUrl.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed
  }
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = url.pathname === '/' || url.pathname === '' ? '/channel' : url.pathname
  return `${wsProtocol}//${url.host}${path}`
}

/** 非配对链接的手工输入宽容解析：接受 ws(s):// 直连地址或 http(s) 主机地址。 */
export function normalizeChannelUrl(text: string): string {
  const trimmed = text.trim()
  if (/^wss?:\/\//i.test(trimmed)) return trimmed
  return channelUrlOf(trimmed)
}
