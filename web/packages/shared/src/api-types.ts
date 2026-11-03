/**
 * API contracts for codync-host (host/src/api/http.rs, v2.38.0).
 *
 * Transport (loopback + `Authorization: Bearer <token>`, default port 19222):
 *   POST /api/<method>      — command; JSON body in, JSON answer out
 *   GET  /events?since=rev  — SSE: catch-up in rev order, then live (keep-alive 15 s)
 *   GET  /term/{id}         — SSE: a setup terminal's output
 *   GET  /health            — open to the network (identity only)
 *   GET  /channel?v=1       — the E2E WebSocket phones use (handshake authenticates)
 *
 * Errors: non-2xx with `{"error": "<message>"}` — 400 bad request, 401 invalid token,
 * 403 loopback-only method, 404 unknown method, 409 conflict, 413 too large.
 */

import type { Bot, Entry, Hello, ScreenState, Usage, CustomIcons } from './models'

/** The JSON body of a failed call. */
export interface ApiErrorBody {
  error: string
}

// ---- SSE event stream (GET /events) ----

/** First item of every stream, then `catchUp` items follow. */
export interface HelloEvent {
  type: 'hello'
  hostId: string
  computerId: string
  rev: number
  usage: Usage
  screen: ScreenState
  /** Live state like the two above: a `network` event sent before the stream began is in it. */
  network: unknown
  /** How many catch-up events follow: `rev` can be ahead of all of them. */
  catchUp: number
}

export interface BotEvent {
  type: 'bot'
  rev: number
  bot: Bot
}

export interface EntryEvent {
  type: 'entry'
  rev: number
  entry: Entry
}

export interface ArtifactEvent {
  type: 'artifact'
  rev: number
  artifact: { id: string; botId: string; title: string; path: string; updatedAt: number; [k: string]: unknown }
}

export interface IconsEvent {
  type: 'icons'
  icons: CustomIcons
  iconsRevision: number
}

/** A realtime call's lines, delivered to the device holding the call only. */
export interface CallEvent {
  type: 'call'
  owner: string
  [k: string]: unknown
}

/** Lagged (the broadcast buffer ran over): resync from the last rev. */
export interface ResyncEvent {
  type: 'resync'
}

export interface AccessRequestsEvent {
  type: 'accessRequests'
  requests: unknown[]
}

export interface CloudEvent {
  type: 'cloud'
  [k: string]: unknown
}

export interface PairingRequestsEvent {
  type: 'pairingRequests'
  requests: unknown[]
}

/** Every item of `GET /events`: `hello` + catch-up (`bot` · `entry` · `artifact` · `icons`), then live. */
export type HostEvent =
  | HelloEvent
  | BotEvent
  | EntryEvent
  | ArtifactEvent
  | IconsEvent
  | CallEvent
  | ResyncEvent
  | AccessRequestsEvent
  | CloudEvent
  | PairingRequestsEvent

// ---- Caller kinds and the loopback boundary (api/devices.rs) ----

/** `Local`: this computer's own apps and helpers (loopback + bearer token).
 *  `Device`: an authorized device over the E2E channel, with scopes.
 *  `Pairing`: a channel opened to redeem a pairing code; may only call `pair`. */
export type CallerKind = 'local' | 'device' | 'pairing'

export type Scope = 'control' | 'screen'

/**
 * Methods only this computer may call (403 for a device). ADR-001: the web client
 * talks to the host over `GET /channel` as `Caller::Device`, so the host itself
 * denies these — no bridge whitelist is needed. Kept as the auditable contract
 * (tests, docs, and any future bridge must respect it).
 */
export const LOCAL_ONLY_METHODS: readonly string[] = [
  'hostUpdateStatus',
  'checkHostUpdate',
  'setHostAutomaticUpdates',
  'setScreenEnabled',
  'requestScreenPermission',
  'setAnalytics',
  'track',
  'reportError',
  'setVoiceKey',
  'previewImport',
  'importBots',
  'pairing',
  'computerCall',
  'computerTools',
  'chatCall',
  'teamCall',
  'agentCall',
  'manageCall',
  'memoryCall',
  'routineCall',
  'composioCall',
  'connectorTarget',
  'connectorRuntime',
  'connectorCall',
  'claimSign',
  'unclaim',
  'devices',
  'revokeDevice',
  'accessRequests',
  'decideAccessRequest',
  'pairingRequests',
  'decidePairing',
  'pairingCodeOpen',
  'cloudStatus',
  'setCloud',
  'setCloudUrl',
  'setApproval',
  'setAssistants',
  'networkStatus',
  'networkCreate',
  'networkJoin',
  'networkLeave',
  'networkInvite',
  'networkPeers',
  'networkRemove',
  'networkPromote',
  'networkRecover',
  'setNetworkRules',
]

/** Methods that need the `screen` scope on a device caller; the rest need `control`. */
export const SCREEN_METHODS: readonly string[] = [
  'screenPrepare',
  'screenOffer',
  'screenClose',
  'screenTakeover',
  'screenCandidate',
  'screenCandidates',
]

export const isLocalOnly = (method: string) => (LOCAL_ONLY_METHODS as readonly string[]).includes(method)
export const isScreenMethod = (method: string) => (SCREEN_METHODS as readonly string[]).includes(method)

/** Whether a device caller may invoke `method` (api/devices.rs `permit`). */
export function deviceMayCall(method: string, scopes: Scope[]): boolean {
  if (method === 'pair' || isLocalOnly(method)) return false
  const needs: Scope = isScreenMethod(method) ? 'screen' : 'control'
  return scopes.includes(needs)
}

// ---- Core method signatures (the Phase 1 chat MVP set) ----

import type { Attachment, Backend, BotDraft, DirListing, PairingInfo, AuthorizedDevice } from './models'

/** A `POST /api/<method>` call: body in, JSON answer out. */
export type ApiCaller = <B = unknown, R = unknown>(method: string, body?: B) => Promise<R>

/** Typed signatures for the methods the web client's core flows use. Every other
 *  method follows the same envelope and returns its own JSON shape. */
export interface CoreApiCalls {
  hello(): Promise<Hello>
  history(b: { botId: string; beforeSeq?: number; limit?: number }): Promise<{ entries: Entry[] }>
  send(b: {
    botId: string
    text?: string
    attachments?: string[]
    clientNonce?: string
    replyTo?: string
    pasted?: string[]
    call?: string
  }): Promise<{ entry: Entry }>
  upload(b: {
    botId: string
    uploadId: string
    name: string
    /** One base64 chunk, appended at `offset`. */
    data: string
    offset?: number
    done?: boolean
  }): Promise<{ attachment: Attachment }>
  readUpload(b: { botId: string; uploadId: string; offset?: number }): Promise<{ data: string; size: number }>
  readFile(b: { entryId: string; fileId: string; offset: number }): Promise<{ data: string; size: number }>
  createBot(b: BotDraft): Promise<{ bot: Bot }>
  updateBot(b: BotDraft): Promise<{ bot: Bot }>
  deleteBot(b: { botId: string }): Promise<Record<string, never>>
  reorderBots(b: { ids: string[] }): Promise<Record<string, never>>
  renameSection(b: { from: string; to?: string | null }): Promise<Record<string, never>>
  setLead(b: { botId: string }): Promise<Record<string, never>>
  markRead(b: { botId: string }): Promise<Record<string, never>>
  stop(b: { botId: string }): Promise<Record<string, never>>
  switchBack(b: { botId: string }): Promise<Record<string, never>>
  newSession(b: { botId: string }): Promise<Record<string, never>>
  react(b: { entryId: string; emoji: string }): Promise<{ entry: Entry }>
  respondPermission(b: { entryId: string; optionId?: string | null }): Promise<Record<string, never>>
  listDirs(b: { path?: string }): Promise<DirListing>
  selectWorkspace(b: { path: string }): Promise<{ path: string }>
  usage(b: { refresh?: boolean }): Promise<Usage>
  refreshBackends(): Promise<{ backends: Backend[] }>
  icons(): Promise<{ icons: CustomIcons; iconsRevision?: number }>
  screenStatus(): Promise<ScreenState>
  pairing(b: { shortCode?: boolean }): Promise<PairingInfo>
  devices(): Promise<{ devices: AuthorizedDevice[] }>
}

// ---- Sync model ----

/** Every mutation stamps a global `rev`; clients catch up with `GET /events?since=<rev>`
 *  (in rev order, then live) and upsert by id. Never skip an undecodable event: resync
 *  from rev 0 instead (`{"type":"resync"}` means the live buffer ran over). */
export interface SyncCursor {
  rev: number
}

// ---- `/channel` E2E wire (host/src/remote/channel.rs, ADR-001) ----

/** Why the host refuses a channel (`{"t":"reject","code":...}`), with its WebSocket
 *  close code (api/devices.rs `RejectCode`). RemoteClient maps these to UX:
 *  re-pair on 4001, show "revoked" on 4003, back off on 4008, update on 4400. */
export type RejectCode =
  | 'unauthorized'
  | 'revoked'
  | 'leaseExpired'
  | 'badSignature'
  | 'unsupportedVersion'
  | 'pairingClosed'
  | 'rateLimited'

export const REJECT_CLOSE_CODES: Record<RejectCode, number> = {
  unauthorized: 4001,
  leaseExpired: 4001,
  badSignature: 4001,
  revoked: 4003,
  rateLimited: 4008,
  unsupportedVersion: 4400,
  pairingClosed: 4410,
}

/** Client → host, first message on `/channel` (plaintext, then encryption starts). */
export interface ChannelHello {
  t: 'hello'
  v: 1
  /** Device public key (Ed25519), base64, 32 bytes. */
  dk: string
  /** Ephemeral X25519 public key, base64, 32 bytes. */
  ek: string
  /** Random nonce, base64, 32 bytes. */
  n: string
  /** Ed25519 signature over `hs1_input(cid, dk, ek, n)`, base64, 64 bytes. */
  sig: string
  /** True on a pairing channel: the first call inside must be `pair`. */
  pair?: boolean
}

/** Host → client reply to a valid hello (plaintext). Verify `sig` against the
 *  host's pinned public key before trusting the channel. */
export interface ChannelWelcome {
  t: 'welcome'
  v: 1
  /** Host ephemeral X25519 public key, base64. */
  ek: string
  /** Host signature over the transcript hash. */
  sig: string
}

/** Sent (still plaintext) right before the socket closes with the reject's code. */
export interface ChannelReject {
  t: 'reject'
  code: RejectCode
  message: string
}

/** Inside the encrypted channel every exchange uses this envelope. */
export interface ChannelRequest {
  id: number
  /** An API method name (see `CoreApiCalls`) or a channel command like `pair`. */
  m: string
  b?: unknown
}

export interface ChannelReply {
  id: number
  r: unknown
}

export interface ChannelError {
  id: number
  err: { status: number; message: string }
}

/** Subscription: `{"id","sub","b"?}` — the host pushes stream items by kind. */
export interface ChannelSubscribe {
  id: number
  sub: string
  b?: unknown
}

export type ChannelMessage = ChannelRequest | ChannelReply | ChannelError | ChannelSubscribe

/** Protocol-level WebSocket close codes on `/channel` (channel.rs `mod close`, §7.6).
 *  Distinct from `REJECT_CLOSE_CODES` (which the host sends inside `reject` before
 *  closing): these arrive as bare close frames — RemoteClient's reconnect policy keys on them. */
export const CHANNEL_CLOSE_CODES = {
  normal: 1000,
  /** Handshake timeout (no hello). */
  timeout: 1011,
  unauthorized: 4001,
  protocolError: 4002,
  /** Frame counters drifted too far: reconnect and rekey. */
  rekey: 4011,
  /** A frame exceeded the size cap. */
  tooLarge: 4013,
  /** Pairing channel finished; the device key is registered. */
  paired: 4100,
  /** Pairing code expired or pairing closed. */
  pairingExpired: 4410,
} as const
