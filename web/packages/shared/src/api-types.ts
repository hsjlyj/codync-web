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

import type { Artifact, Attachment, Bot, Entry, Hello, ScreenState, Usage, CustomIcons } from './models'

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
  artifact: Artifact
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

import type { Backend, BotDraft, DirListing, PairingInfo, AuthorizedDevice } from './models'

/** A `POST /api/<method>` call: body in, JSON answer out. */
export type ApiCaller = <B = unknown, R = unknown>(method: string, body?: B) => Promise<R>

/** Typed signatures for the methods the web client's core flows use. Every other
 *  method follows the same envelope and returns its own JSON shape. */
export interface CoreApiCalls {
  hello(): Promise<Hello>
  history(b: { botId: string; beforeSeq?: number; limit?: number }): Promise<{ entries: Entry[] }>
  /** Notices between a bot and one peer (the newest 200), for the read-only bot conversation sheet. */
  botConversation(b: { botId: string; peerId: string }): Promise<{ entries: Entry[] }>
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
  /** `id` is required for an update (hub.rs:251). Section/pinned/hidden ride on the same
   *  patch — there are no setBotSection/setBotPinned/setBotHidden methods. */
  updateBot(b: BotDraft): Promise<{ bot: Bot }>
  /** Roster removal is event-driven: the host emits a bot event with `deleted: true` (hub.rs). */
  deleteBot(b: { botId: string }): Promise<Record<string, never>>
  reorderBots(b: { ids: string[] }): Promise<Record<string, never>>
  renameSection(b: { from: string; to?: string | null }): Promise<Record<string, never>>
  setLead(b: { botId: string }): Promise<Record<string, never>>
  markRead(b: { botId: string }): Promise<Record<string, never>>
  stop(b: { botId: string }): Promise<Record<string, never>>
  switchBack(b: { botId: string }): Promise<Record<string, never>>
  newSession(b: { botId: string }): Promise<Record<string, never>>
  react(b: { entryId: string; emoji: string }): Promise<{ entry: Entry }>
  /** The host derives the bot from the entry's author — do NOT send `botId` (api/bots.rs:270). */
  respondPermission(b: { entryId: string; optionId?: string | null }): Promise<Record<string, never>>
  /** The bot's library: artifacts plus file-message attachments, newest first. No host
   *  `search` method exists — searching filters loaded entries client-side. */
  library(b: { botId: string }): Promise<{ items: LibraryItem[] }>
  readArtifact(b: { botId: string; artifactId: string; offset: number }): Promise<{ data: string; size: number; artifact: Artifact }>
  renameArtifact(b: { botId: string; artifactId: string; title: string }): Promise<{ artifact: Artifact }>
  listDirs(b: { path?: string }): Promise<DirListing>
  selectWorkspace(b: { path: string }): Promise<{ path: string }>
  usage(b: { refresh?: boolean }): Promise<Usage>
  refreshBackends(): Promise<{ backends: Backend[] }>
  icons(): Promise<{ icons: CustomIcons; iconsRevision?: number }>
  /** Starts a host-owned setup terminal; subscribe its output with `sub: "term"`. */
  agentSetup(b: { step: 'install' | 'login' | 'node'; backend?: string; method?: string; cols?: number; rows?: number }): Promise<{ term: string }>
  termInput(b: { term: string; data: string }): Promise<Record<string, never>>
  termResize(b: { term: string; cols: number; rows: number }): Promise<Record<string, never>>
  termClose(b: { term: string }): Promise<Record<string, never>>
  /** Reserves a session (≤32 total, ≤4 per device, pending 60 s) before ICE gathering. */
  screenPrepare(b: { relay?: boolean; trickle?: boolean }): Promise<ScreenPrepareResult>
  /** Sends the viewer's offer; the host answers with its SDP. Needs the screen scope.
   *  MUST run after the `screenCandidates` subscription is open, or the host answers
   *  400 "open screenCandidates before offering" (screen/signaling.rs:134). */
  screenOffer(b: { session: string; sdp: string; display?: number }): Promise<Record<string, unknown>>
  screenCandidate(b: { session: string; candidate: unknown }): Promise<Record<string, never>>
  screenClose(b: { session: string }): Promise<Record<string, never>>
  screenTakeover(b: { on?: boolean }): Promise<ScreenState>
  /** Voice keys are entered at the computer (`setVoiceKey` is LOCAL_ONLY); a device only reads. */
  voiceStatus(): Promise<VoiceStatus>
  voiceSession(b: { provider: string; model: string; voice: string }): Promise<{ credential: unknown }>
  voiceModels(b: { provider: string }): Promise<Record<string, unknown>>
  voiceTranscribe(b: { provider: string; model: string; audio: string }): Promise<Record<string, unknown>>
  voiceSpeak(b: { provider: string; model: string; voice: string; text: string }): Promise<Record<string, unknown>>
  screenStatus(): Promise<ScreenState>
  pairing(b: { shortCode?: boolean }): Promise<PairingInfo>
  devices(): Promise<{ devices: AuthorizedDevice[] }>
}

// ---- Pairing-channel `pair` (remote/channel/pairing.rs — NOT an api::dispatch method) ----

/** A device certificate the Codync cloud signed (remote/certificate.rs): the pairing
 *  flow presents it; a missing one is rejected with close 4400. */
export interface DeviceCertificate {
  /** Stringified JSON `{v: 1, deviceKey, userId, email, exp}`. */
  payload: string
  /** Cloud signature over `DOMAIN + payload`, base64url. */
  sig: string
}

/** The one message a pairing channel accepts (`{"m":"pair"}`, pairing.rs:200). */
export interface PairRequest {
  /** The one-time pairing code from `pairing` (16-byte base64url, or the QR URL's code). */
  code: string
  /** Device name as the computer's user will see it on the approval prompt. */
  name: string
  platform: string
  certificate: DeviceCertificate
  /** Present when the phone wants the computer to join its cloud account. */
  claim?: { claimId: string; nonce: string }
}

/** `pair` success reply; the socket then closes with `4100 paired` — reconnect as an
 *  authorized device (new channel, no `pair` flag). The device is registered with
 *  both `control` and `screen` scopes (pairing.rs:120). */
export interface PairReply {
  computerId: string
  name: string
  /** The signed claim, when the request carried one and the computer joined the account. */
  claim?: unknown | null
}

/** Channel subscriptions (channel/subscriptions.rs): `events` (b: {since?, client?}) →
 *  `HostEvent` items; `term` (b: {term}) → `TermEvent` items, 404 when the terminal is
 *  gone; `screenCandidates` (b: {session}, screen scope) → ordered ICE candidates.
 *  Each item arrives as `{"id","ev"}`; the stream ends with `{"id","end":true}`;
 *  over `MAX_SUBS` concurrent subs answers 429. */
export interface ChannelEventPush {
  id: number
  ev: unknown
}

export interface ChannelEndPush {
  id: number
  end: true
}

export type ChannelPush = ChannelEventPush | ChannelEndPush

/** One terminal event: output bytes (base64) or the exit code. */
export type TermEvent = { type: 'output'; data: string } | { type: 'exit'; code: number }

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface ScreenPrepareResult {
  session: string
  iceServers: IceServer[]
  expiresAt: number
  trickle: boolean
}

export interface VoiceStatus {
  providers: { provider: string; configured: boolean; defaults: unknown }[]
}

/** One `library` item: an artifact record, or a file message's attachment. */
export type LibraryItem =
  | { kind: 'artifact'; at: number; artifact: Artifact }
  | { kind: 'attachment' | 'file'; at: number; entryId: string; file: Attachment }

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
  /** Device public key (Ed25519), base64url (no padding), 32 bytes. */
  dk: string
  /** Ephemeral X25519 public key, base64url (no padding), 32 bytes. */
  ek: string
  /** Random nonce, base64url (no padding), 32 bytes. */
  n: string
  /** Ed25519 signature over `hs1_input(cid, dk, ek, n)`, base64url (no padding), 64 bytes. */
  sig: string
  /** True on a pairing channel: the first call inside must be `pair`. */
  pair?: boolean
}

/** Host → client reply to a valid hello (plaintext). Verify `sig` against the
 *  host's pinned public key before trusting the channel. */
export interface ChannelWelcome {
  t: 'welcome'
  v: 1
  /** Host ephemeral X25519 public key, base64url (no padding). */
  ek: string
  /** Host signature over the transcript hash, base64url (no padding). */
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
  /** The method's answer (`ok` — channel.rs:492; an old `r` reading was wrong). */
  ok: unknown
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

/** One encrypted frame on the wire (crypto.rs `Sealer::seal`): `d` seals
 *  `[flag][chunk]` with ChaCha20-Poly1305 — flag 0x00 final / 0x01 more,
 *  nonce = 4 zero bytes + counter BE, AAD = "codync/frame/v1" + counter BE,
 *  chunk ≤256 KiB, rekey at 2³² frames. A message of n chunks is n frames. */
export interface ChannelFrame {
  t: 'f'
  /** Frame counter, starts at 0 per direction. */
  c: number
  /** Sealed chunk, base64url (no padding). */
  d: string
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
