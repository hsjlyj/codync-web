# ADR-001：Web 客户端远程连接方案——浏览器直连 `/channel` E2E 通道

- **状态**：已采纳（Accepted）
- **日期**：2026-11-03
- **决策者**：岚序（架构师）、左丞（调研）、砚边（安全审计）三方共识，若光拍板
- **影响范围**：Codync Web 化 Phase 0–3 全部

## 背景

主机 HTTP API（`host/src/api/http.rs:60-67` `authorized()`）强制要求
`is_loopback(peer.ip()) && Bearer token`，浏览器无法直接调用。
需要在不破坏主机安全模型的前提下，让浏览器 Web 客户端访问主机。

## 被拒方案

### 方案 B：本地 Bridge/Relay 持有主机 Bearer Token 做反向代理

- **致命缺陷**：Bridge 一旦持有主机 token，即获得 `Caller::Local` 身份，
  可调用 `devices.rs:32-88` `LOCAL_ONLY` 列表中的全部 48 个高危方法
  （`revokeDevice`、`setCloud`、`pairingRequests`、`networkCreate`、`claimSign`、
  `computerCall` 等）。Bridge 被攻破 = 主机完全沦陷（砚边审计定级：高危）。
- **次生缺陷**：需要修改 `authorized()` 放行非 loopback IP，等于在主机上开后门，
  破坏所有已有客户端（桌面端、手机端）的安全模型。
- **遗留清理**：`web/relay/`（旧持 token PoC，CORS `*` + Bearer 转发设计）
  与 `web/bridge/`（安全空壳）均已删除。

### 方案 C：修改主机 `authorized()` 放行 Relay IP

- 直接拒绝。破坏性改动，影响全部已有客户端安全模型。

## 采纳方案：方案 A —— 浏览器直连主机 `/channel` E2E 通道

```
浏览器 (Next.js Web 客户端)
  │  WebSocket GET /channel?v=1（host/src/api/http.rs:196-207）
  │  握手：device key(Ed25519) + 签名 + X25519 ECDH（channel.rs:231-309）
  │  加密帧：ChaCha20-Poly1305，AAD="codync/frame/v1"（crypto.rs:98-159）
  ▼
codync-host (Rust)
  └─ 内层 RPC 走 api::dispatch，Caller::Device，主机 permit() 按 scope 过滤
     （devices.rs:104-114）——48 个 LOCAL_ONLY 方法天然不可达
```

### 关键事实

| 事项 | 证据 |
|------|------|
| `/channel` 不限 loopback，设备密钥认证 | http.rs:195-207, channel.rs:231-309 |
| 权限边界由主机 `permit()` 执行，Device 可调 103/151 方法 | devices.rs:104-114 |
| Phase 1 MVP 所需方法 100% 在 Device 可调范围内 | api-reference.md §5 |
| 帧加密 ChaCha20-Poly1305，WebCrypto 不支持，需 `@noble/ciphers` | crypto.rs:98-144 |
| X25519/Ed25519/HKDF-SHA256 浏览器 WebCrypto 原生支持（现代浏览器） | crypto.rs:81-96 |
| 官方测试向量 12 组，可做回归基线 | docs/reference/fixtures/remote-relay-vectors.json |
| close code 两组：协议级 8 个（channel.rs:46-55）、reject 级 5 个（devices.rs:124-138） | — |

### 依赖边界

- `@noble/ciphers`（ChaCha20-Poly1305）+ `@noble/curves`（统一曲线原语）
  挂在 **Web 客户端自己的 package.json**，**不得进入 `@codync/shared`**
- `@codync/shared` 保持零运行时依赖（纯 type + 纯函数），桌面端不受影响
- 加密帧编解码是 `ChannelTransport` 的实现细节，对 `HostTransport` 接口透明

### 分层契约

- Web 端实现 `ChannelTransport implements HostTransport`（call + stream）
- 上层 `HostClient` / `BotStore` / `AppModel` 逻辑复用桌面端抽象
- 禁止 import `apps/desktop/src/renderer/` 源码，只依赖 `@codync/shared` 类型

## 工作区约定

- **唯一工作树**：`/workspace/codync-2.38.0/`（从 `codync-v2.38.0.tar.gz` 解压）
- `/tmp/Codync-2.38.0/` 与 `/workspace/web/` 已废弃，产物不再同步
- 所有路径引用统一为 `codync-2.38.0/web/...`

## 后果

- 正面：无中间层，攻击面为零；权限天然由主机控制；上层代码高复用
- 代价：浏览器端需实现握手 + 加密帧（约 500-800 行 TS，3-5 天，有官方向量和手机端参考实现）
- 风险：老浏览器不支持 X25519/Ed25519 时需降级提示（Chrome 133+/Safari 17+ 可用）

### 主机侧配对约束（2026-11-04 架构评审补充，证据经逐行核实）

1. **平台白名单**：`host/src/remote/channel/pairing.rs:35` 原只接受
   `ios|macos|android`，Web 报 `web` 会被 400 拒。已加 `"web"`（additive，
   `platform` 仅用于 analytics 和设备列表显示，不影响 `let_in` 的
   scopes，pairing.rs:116 固定 `[Control, Screen]`）。
   - 该改动属主机 shipped code，须随版本 bump 发布（仓库 AGENTS.md 规则）
   - **Web 客户端须声明 `minHost`**：低于该版本的主机不认识 `web`，
     客户端在 400 时回退报 `macos`（仅影响显示，不提权）
2. **云签发设备证书强制**：`pairing.rs:81-88` → `certificate.rs:69-74`，
   2.38.0 起 `pair` 必须携带云签发的 `{payload, sig}` 设备证书，
   缺失 → `Refusal::Missing` → `RejectCode::UnsupportedVersion` → close **4400**
   （devices.rs:135）。
   - 正式 Web 配对链路 = 云账号登录 → 云签发证书 → `pair`，属 Phase 2
   - 无云 / 私有部署场景：用 `CODYNC_DEVICE_CERT_KEY` 自签证书
     （certificate.rs:41-45），测试可复用 `test_certificate` 向量
