# Codync Host API 参考（Web 客户端对接用）

> 数据来源：`host/src/api/`（mod.rs · host.rs · bots.rs · network.rs · remote.rs · marketplace.rs · devices.rs · http.rs · events.rs），版本 **2.38.0**。
> 共享类型包：`packages/shared/src/models.ts`（实体类型）+ `packages/shared/src/api-types.ts`（API 契约）。

## 1. 传输与认证

| 路由 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/<method>` | POST | loopback + `Authorization: Bearer <token>`（`~/.codync/token`） | 命令：JSON 请求体 → JSON 应答 |
| `/events?since=<rev>&client=<ios\|android\|macos>` | GET (SSE) | 同上 | 追平（rev 顺序）+ 实时；keep-alive 15s |
| `/term/{id}` | GET (SSE) | 同上 | 安装/登录终端输出流 |
| `/health` | GET | 无（开放） | 主机身份；loopback 附加 binaryPath/busy 等 |
| `/channel?v=1` | GET (WebSocket) | E2E 握手认证（无 Bearer） | 手机/远程设备的端到端加密通道 |
| `/hooks/routines/{id}` | POST | webhook 凭据 | 例程 webhook 触发 |
| `/ingest/statusline` | POST | loopback + Bearer | 用量状态行采集 |
| `/oauth/callback` | GET | 一次性 `state` | 连接器 OAuth 回调（仅 loopback） |

- 默认端口 **19222**；Bearer token 仅接受 loopback（含 `::ffff:127.0.0.1`）。
- 错误统一为非 2xx + `{"error": "<message>"}`：400 参数错 · 401 token 无效 · 403 仅限本机 · 404 未知方法 · 409 冲突 · 413 体积超限。
- **Web 端不直连主机**：浏览器 → Relay（持本地 token，决定转发白名单）→ `POST /api/*` + SSE。

## 2. 同步模型

- 每次变更盖一个全局递增 **`rev`**；客户端 `GET /events?since=<rev>` 追平后转实时，按 **id upsert**，不丢不改乱序。
- 事件流首条为 `hello`（含当前 rev、usage、screen、network、catchUp 数量），随后是追平事件（`bot` · `entry` · `artifact` · `icons`）。
- `{"type":"resync"}` = 广播缓冲溢出，客户端须从最后 rev 重追；不可解码的事件**不能跳过**，回退到 rev 0 重追。
- 本机专属事件（设备通道收不到）：`accessRequests` · `cloud` · `pairingRequests`；`call` 事件只发给持有该通话的设备。

### SSE 事件结构（`packages/shared/src/api-types.ts`）

| type | 载荷 |
|------|------|
| `hello` | `{hostId, computerId, rev, usage, screen, network, catchUp}` |
| `bot` | `{rev, bot: Bot}` |
| `entry` | `{rev, entry: Entry}` |
| `artifact` | `{rev, artifact}` |
| `icons` | `{icons, iconsRevision}` |
| `call` | `{owner, …}`（仅通话持有设备） |
| `resync` | `{}` |
| `accessRequests` / `cloud` / `pairingRequests` | 仅 loopback 流 |

## 3. 数据字典（核心实体）

完整定义见 `packages/shared/src/models.ts`，字段与主机 camelCase JSON 一致，时间为 epoch 毫秒。

| 实体 | 关键字段 | 说明 |
|------|----------|------|
| `Bot` | `id, kind(agent\|group), members, backend, cwd, permission(ask\|auto), mode, model, modelOptions, fastMode*, fallbacks[], agentStep, resting[], pinned, lead, position, section, hidden, connectors[], skills[], computer, manageTeam, sharedMemory, memoryRev, status(idle\|working\|needsInput\|error), activity, unread, lastMessage, lastAt, rev, createdAt` | 名下 40+ 字段，`normalizeBot()` 宽容归一化（新旧主机兼容） |
| `Entry` | `id, seq, botId, rev, kind(user\|agent\|thought\|tool\|plan\|permission\|notice), turn, data: EntryData, createdAt, updatedAt` | 聊天记录的最小单位；`isChat()` 决定是否进聊天视图 |
| `EntryData` | `text, final, status, clientNonce, replyTo, attachments[], files[], artifact, reactions, botReactions, diffs[], options[], command, output, call, transcript[] …` | 按 `kind` 取用；`final=true` 的 agent 条目是最终回复 |
| `Attachment` / `SharedFile` | `id, name, size` / + `sha256` | `showsAsImage()`：图片且 ≤20MB 内联显示 |
| `ArtifactCard` | `id, title, updatedAt` | 聊天中的 artifact 卡片；全文经 `library`/`readArtifact` 取 |
| `Fallback` / `AgentStep` / `Resting` | `backend, model, modelOptions` / `step, agent, since, reason` / `agent, until, reason` | bot 的代理回退链状态 |
| `Backend` | `id, name, available, command, installHint, installed, signedIn …` | 已安装的 agent（Claude Code、Codex…） |
| `Hello` | `hostId, name, version, os, backends[], rev, screen, urls[], computerId, signKey, boxKey, minApp, canUpdate, cloud, analytics` | 主机自述 |
| `ScreenState` / `ScreenDisplay` | `enabled, connected, capture, input, displays[], userControl, viewers` | 远程屏幕状态 |
| `Usage` / `UsageProvider` / `UsageWindow` | `providers[] → windows[] → {percent, resetsAt, text}` | 用量（Claude/Codex/Cursor 等来源） |
| `AuthorizedDevice` | `key, name, platform, source(local\|account), scopes[], leaseUntil, connected` | 已授权设备 |
| `CloudStatus` | `enabled, url, registered, connected, owner, approval(code\|auto), relay(codync\|private), assistants` | 云中继状态 |
| `Computer` | `id, name, signKey, boxKey, urls[], cloud` | 多计算机网络中的对端（无私钥） |
| `DirListing` / `DirItem` | `path, parent, isGit, dirs[], recent[], ancestors[]` | 文件夹浏览（`listDirs`） |
| `BotDraft` / `GroupDraft` | 同 `Bot` 的可写字段 | createBot / updateBot 载荷 |

辅助纯函数（随类型一起复用）：`normalizeBot` · `normalizeScreen` · `draftOf` · `isChat` · `isReplyable` · `quoteOf` · `isWorking` · `needsInput` · `isGroup` · `groupBotReactions` · `showsAsImage` · `isImageName`。

## 4. 方法清单（151 个，6 组）

调用方式统一为 `POST /api/<method>`，请求体为 JSON 对象；「→」后为应答关键字段。

### 4.1 主机与计算机（36）

| 方法 | 请求 | 应答 |
|------|------|------|
| `hello` | `{}` | `Hello`（含 `joinAccount`） |
| `refreshBackends` **P2** | `{}` | `{backends}` |
| `usage` **P2** | `{refresh?}` | `Usage` |
| `listDirs` **P2** | `{path?}` | `DirListing`（含 recent） |
| `selectWorkspace` **P2** | `{path}` | `{path}`（校验可读并记忆） |
| `agentSetup` | `{backend, step(install\|login\|node), method?, cols?, rows?}` | `{term: id}` |
| `agentModels` | `{backend}` | 该 agent 可用模型 |
| `agentAuth` | `{backend}` | `{signedIn, …}` |
| `agentAuthenticate` | `{backend, method}` | `{signedIn, …}` |
| `setAgentEnv` | `{backend, vars}` | 状态 |
| `termInput` | `{term, data}` | `{}` |
| `termResize` | `{term, cols, rows}` | `{}` |
| `termClose` | `{term}` | `{}` |
| `hostUpdateStatus` 🔒 | `{}` | 更新状态 |
| `checkHostUpdate` 🔒 | `{}` | 检查结果 |
| `setHostAutomaticUpdates` 🔒 | `{enabled}` | `{}` |
| `installHostUpdate` | `{force?}` | `{scheduled}`（bot 忙时拒绝） |
| `voiceStatus` | `{}` | 语音配置状态 |
| `setVoiceKey` 🔒 | `{provider, key?}` | `{}` |
| `voiceSession` | `{provider, model, voice}` | 会话凭据 |
| `voiceModels` | `{provider}` | 模型列表 |
| `voiceTranscribe` | `{provider, model, audio}` | 文本 |
| `voiceSpeak` | `{provider, model, voice, text}` | 音频 |
| `screenStatus` | `{}` | `ScreenState` |
| `requestScreenPermission` 🔒 | `{…}` | 请求系统权限 |
| `screenPrepare` | `{relay?, trickle?}` | `{session, ice…}`（需 Screen 范围） |
| `screenOffer` | `{session, sdp, display?}` | 应答 SDP |
| `screenCandidate` | `{session, candidate}` | `{}` |
| `screenClose` | `{session}` | `{}` |
| `screenTakeover` | `{on?}` | `ScreenState` |

> 另有 `screenCandidates`：不是 HTTP 方法，是 `/channel` WebSocket 的 ICE 候选订阅（`remote/channel/subscriptions.rs`），同样受 Screen 范围限制。
| `setScreenEnabled` 🔒 | `{enabled}` | `ScreenState` |
| `setAnalytics` 🔒 | `{enabled}` | `{enabled}` |
| `track` 🔒 | `{event, …}` | `{}` |
| `reportError` 🔒 | `{…}` | `{}` |
| `computerTools` 🔒 | `{}` | 工具列表 |
| `computerCall` 🔒 | `{botId, name, arguments}` | 工具结果 |

### 4.2 Bot 与聊天（48）

| 方法 | 请求 | 应答 |
|------|------|------|
| `history` **P1** | `{botId, beforeSeq?, limit?(1-500, 默认100)}` | `{entries: Entry[]}` |
| `botConversation` **P1** | `{botId, peerId}` | `{entries}`（两 bot 间通知，≤200 条） |
| `send` **P1** | `{botId, text?, attachments?(uploadId[]), clientNonce?, replyTo?, pasted?, call?}` | `{entry}`（text 与 attachments 不能全空；clientNonce 幂等去重） |
| `upload` **P1** | `{botId, uploadId, name, data(b64块), offset?, done?}` | `{attachment}` |
| `readUpload` **P1** | `{botId, uploadId, offset?}` | `{data(b64), size}`（384KB/块） |
| `readFile` **P1** | `{entryId, fileId, offset}` | `{data(b64), size}`（仅 bot 最终回复的文件） |
| `createBot` **P1** | `BotDraft` | `{bot}` |
| `updateBot` **P1** | `BotDraft` | `{bot}` |
| `deleteBot` **P1** | `{botId}` | `{}` |
| `reorderBots` **P2** | `{ids[]}` | `{}` |
| `renameSection` **P2** | `{from, to?(缺失即错，null/空名=移除)}` | `{}` |
| `setLead` | `{botId}` | `{}` |
| `markRead` | `{botId}` | `{}` |
| `stop` | `{botId}` | `{}`（组停止全部成员） |
| `switchBack` | `{botId}` | `{}` |
| `newSession` | `{botId}` | `{}` |
| `react` | `{entryId, emoji}` | `{entry}` |
| `respondPermission` **P1** | `{entryId, optionId?}` | `{}` |
| `memory` / `memoryFile` | `{botId, …}` | 记忆内容/文件 |
| `library` **P2** | `{botId}` | artifact 列表 |
| `readArtifact` / `renameArtifact` **P2** | `{botId, id…}` | 内容/确认 |
| `editHandoff` / `keepConversation` | `{botId, …}` | 交接卡操作 |
| `routines` | `{botId}` | 例程列表 |
| `saveRoutine` | `{botId, …}` | 保存 |
| `setRoutineEnabled` | `{botId, id, enabled}` | `{}` |
| `deleteRoutine` | `{botId, id}` | `{}` |
| `runRoutine` | `{botId, id}` | 入队（source=test） |
| `retryRoutineRun` | `{botId, runId}` | 重试 |
| `routineSchedule` | `{…}` | 调度预览 |
| `routineWebhook` | `{botId, id, rotate?}` | webhook 凭据 |
| `routineCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `memoryCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `chatCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `teamCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `agentCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `manageCall` 🔒 | `{botId, name, arguments}` | 结果 |
| `previewImport` 🔒 | `{…}` | 导入预览 |
| `importBots` 🔒 | `{…}` | 导入 |
| `importSkill` | `{}` | 导出技能文本 |
| `callStarted` | `{botId, callId?}` | `{}` |
| `logCall` | `{botId, seconds}` | `{entry}` |
| `startCall` | `{…}` | 通话（仅发起设备收语音指令） |
| `callTool` | `{callId, name, arguments, lines?}` | `{result}` |
| `callLines` | `{callId, lines}` | `{}` |
| `callEntries` | `{botId, callId}` | `{entries}` |
| `endCall` | `{botId, callId, seconds, lines?}` | `{entry}` |

### 4.3 网络（11，除 `networkView` 外全部 🔒 本机）

`networkStatus` 🔒 · `networkView` · `networkCreate` 🔒 · `networkJoin` 🔒 · `networkLeave` 🔒 · `networkInvite` 🔒 · `networkPeers` 🔒 · `networkRemove` 🔒 · `networkPromote` 🔒 · `networkRecover` 🔒 · `setNetworkRules` 🔒 — `network` 参数为 id 或名称，仅一个网络时可省。

### 4.4 设备与云（21，含全部设备管理 🔒）

| 方法 | 请求 | 应答 |
|------|------|------|
| `pairing` 🔒 **P1** | `{shortCode?}` | `PairingInfo{pairingUrl, urls, expiresAt, shortCode?}`（10 分钟有效，最多 5 个） |
| `devices` 🔒 | `{}` | `{devices: AuthorizedDevice[]}` |
| `revokeDevice` 🔒 | `{key}` | `{}` |
| `forgetDevice` | `{}`（设备只删自己） | `{}` |
| `registerDevice` | `{ticket, relay?, pushKey?, name?, ctx?}` | `{}`（推送注册） |
| `unregisterDevice` | `{}` | `{}` |
| `registerActivity` | `{botId, ticket}` | `{}`（Live Activity） |
| `unregisterActivity` | `{botId}` | `{}` |
| `accessRequests` 🔒 | `{}` | `{requests}` |
| `decideAccessRequest` 🔒 | `{requestId, approve}` | `{}` |
| `pairingRequests` 🔒 | `{}` | `{requests}` |
| `decidePairing` 🔒 | `{requestId, approve}` | `{}` |
| `pairingCodeOpen` 🔒 | `{code}` | `{open}` |
| `unclaim` 🔒 | `{}` | `{}` |
| `cloudStatus` 🔒 | `{}` | `CloudStatus` |
| `setCloud` 🔒 | `{enabled}` | 状态 |
| `setCloudUrl` 🔒 | `{url?, token?}` | 状态 |
| `setApproval` 🔒 | `{approval(code\|auto)}` | 状态 |
| `setAssistants` 🔒 | `{enabled}` | 状态 |
| `claimSign` 🔒 | `{claimId, nonce, userId}` | `ClaimSignature` |
| `joinAccount` | `{claimId, nonce}` | `ClaimSignature`（hello.joinAccount 为真时） |

### 4.5 连接器与技能市场（32）

凭证：`credentialUpdateConnector` · `credentialStatus` · `credentialLogins` · `credentialSaveLogin` · `credentialRemoveLogin` · `credentialSetOnePassword`。
连接器：`connectors` · `connectorInfo` · `connectorRuntime` 🔒 · `connectorCall` 🔒 · `connectorRequestFinish` · `connectorVerify` · `installConnector` · `importConnectors` · `removeConnector` · `connectorSignIn` · `connectorSignInFinish` · `connectorTarget` 🔒。
Composio：`composioCall` 🔒 · `composioStatus` · `setComposioKey` · `composioToolkits` · `composioConnect` · `composioConnectFields` · `composioConnection`。
市场与技能：`marketConnectors` · `marketSkills` · `skills` · `skillDetails` · `installSkill` · `removeSkill` · `agentGear`。

### 4.6 图标（3，mod.rs 直派）

`setIcon`（≤8MB）· `icons` → `{icons, iconsRevision}` · `readFile`（见 4.2）。

> **Phase 2 方法核实（2026-11-04，砚台）**：主机**没有** `setBotPosition` / `setBotSection` / `setBotPinned` / `setBotHidden` / `search` / 独立 `backends` 方法——拖拽排序用 `reorderBots({ids})`；section/pinned/hidden 走 `updateBot` 补丁（`id` 必填，hub.rs:251）；搜索在客户端过滤已加载条目；后端列表来自 `hello` 与 `refreshBackends`。`deleteBot` 收 `{botId}`（非 `{id}`），删除经 `deleted:true` 的 bot 事件反映到花名册。

## 5. 权限边界（ADR-001：Web 客户端走 `/channel`，`Caller::Device`）

调用者三类（`api/devices.rs:12-19`），权限由**主机自身**在 `permit()`（devices.rs:104-114）强制：

| 调用者 | 认证 | 可调方法 | 边界执行点 |
|--------|------|----------|-----------|
| **Local** | loopback + Bearer token | 全部 151 个（除 `pair`） | 主机 `authorized()` |
| **Device**（Web 客户端走此路径） | 设备密钥 + Ed25519 签名握手 | **103 / 151**（48 个 🔒 + `pair` 一律 403） | 主机 `permit()`，按 `control`/`screen` 范围 |
| **Pairing** | 配对码兑换通道 | 仅 `pair` | 主机 `permit()` |

- 🔒 标记 = `LOCAL_ONLY`，共 **48 个**方法，设备调用一律 403。清单固化在 `packages/shared/src/api-types.ts` 的 `LOCAL_ONLY_METHODS`，配套 `isLocalOnly()` / `deviceMayCall()`。
- **关键安全性质（比 Relay 白名单强）**：边界由主机代码执行，Web 端走 `/channel` 时**天然拿不到** LOCAL_ONLY 方法——不需要任何中间层维护白名单，白名单漂移风险为零。浏览器侧即使被 XSS 攻陷，泄露的也只是**一台设备**的 device key（可在主机 `devices` 界面撤销），不等于主机沦陷。
- Screen 类方法（`SCREEN_METHODS`）需 `screen` 范围，其余需 `control`；Web 客户端配对注册时应同时申请两个范围。
- 被拒方案（ADR-001 记录）：白名单 Bridge 持主机 token = `Caller::Local` 全权限（151 方法 + 未来新增默认可用），Bridge 被攻陷 = 主机完全沦陷，且白名单需随方法演进长期维护。

### 5.1 `/channel` 通道协议要点（Web 客户端实现输入，源：channel.rs + crypto.rs）

| 环节 | 规格 |
|------|------|
| 握手 | 客户端 → `{t:"hello", v:1, dk(设备公钥32B), ek(临时X25519公钥32B), n(随机数32B), sig(Ed25519 签名 64B), pair?}`；主机 → `{t:"welcome", v:1, ek, sig}`（channel.rs:231-309） |
| 签名输入 | `hs1_input(cid, dk, ek_d, n)`；主机回签 transcript hash（客户端应验证主机签名防中间人） |
| 密钥派生 | X25519 ECDH → HKDF-SHA256（salt=transcript hash）→ 方向密钥 `d2h`/`h2d`（crypto.rs:120-127） |
| 帧加密 | ChaCha20-Poly1305，nonce = 计数器（12B，后 8B 大端），AAD = `"codync/frame/v1" + 计数器`（crypto.rs:129-146）；单帧明文 ≤256KiB，WebSocket 消息上限 1MiB |
| 请求封套 | `{"id": N, "m": "<method>", "b": {...}}` → `{"id": N, "ok": ...}` 或 `{"id": N, "err": {status, message}}`；订阅 `{"id": N, "sub": "<kind>"}` |
| 拒绝码 | 4001 未授权/租约过期/签名错 · 4003 已撤销 · 4008 限流 · 4400 版本不支持 · 4410 配对未开放（devices.rs:117-152）——RemoteClient 重连 UX 按此区分 |
| 配对码 | 10 分钟有效 · 最多 5 个并存 · 限流 3 次/分/来源、10 次/分/主机（devices.rs:174-177）——认证流程的错误提示按此设计 |
| 配对方法 `pair` | 配对通道内唯一消息（非 dispatch 方法）：`{code, name, platform, certificate, claim?}` → `{"id","ok":{computerId, name, claim?}}`；成功后通道以 **4100 paired** 关闭，客户端须以已授权设备重开通道（设备获得 control+screen 双范围，pairing.rs:120） |
| **回归锚点** | 仓库内 `docs/reference/fixtures/remote-relay-vectors.json`：`handshake`（dk/ek/n/签名输入/transcript hash/派生密钥）· `frames`（3 条 seal/open，含计数器与 final 标志）· `sas`/`pairCheck`/`claim`/`push`/`mailbox` 等 12 组官方向量——Web 端握手与帧编解码的单测必须以它为基线（主机 `crypto.rs` 测试同源） |

### 5.2 浏览器端加密原语可行性

| 原语 | WebCrypto | 结论 |
|------|-----------|------|
| SHA-256 / HKDF | ✅ 原生 | 直接用 |
| X25519 / Ed25519 | ✅ 现代浏览器（Chrome 133+ / Safari 17+ / Firefox 129+） | 用 `@noble/curves` 兜底旧浏览器，或直接统一用 noble 减少分支 |
| ChaCha20-Poly1305 | ❌ WebCrypto 仅 AES-GCM | **必须**引入 `@noble/ciphers`（成熟、体积小、可 tree-shake） |
| 设备密钥存储 | — | 建议 WebCrypto 非导出密钥（non-extractable）优先；localStorage 方案需 @砚边 审计 XSS 面 |

---
*生成：砚台（数据）· 2026-11-03 · 依据 Codync v2.38.0 源码逐方法核对；151 = 36+48+11+21+32+3。ADR-001 共识：方案 A（`/channel` E2E），边界由主机执行。*
