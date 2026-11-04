# Web 客户端架构说明

> 基线：Codync v2.38.0 · 更新：2026-11-04 · 状态：Phase 1 已入库 · 维护：榫卯
> 接入路径遵循 [ADR-001](adr/001-channel-e2e.md)：浏览器直连 `/channel` E2E 通道，无中间层。

## 1. 总览

浏览器**直连**用户自己电脑上的 codync-host 的 `/channel` WebSocket，
端到端加密，**没有任何中间代理层**：

```
┌────────────────────────────────────────────┐
│ Web 客户端（浏览器 SPA，Next.js 静态导出）    │
│  ChannelTransport（WebSocket）              │
│   └─ 实现桌面端 HostTransport 抽象          │
│  AppModel / BotStore（复用桌面端状态模式）    │
└──────────────────┬─────────────────────────┘
                   │ WSS · GET /channel?v=1
                   │ 设备密钥(Ed25519) + X25519 握手
                   │ ChaCha20-Poly1305 加密帧
                   ▼
┌────────────────────────────────────────────┐
│ codync-host（用户电脑，默认端口 19222）       │
│  /channel  WebSocket · Caller::Device       │
│            可调 103/151 方法                │
│  /api/*    仅 loopback + Bearer             │
│            （桌面端与本机工具用，Web 不直连） │
│  /events   SSE · 仅 loopback                │
└────────────────────────────────────────────┘
```

公网可达性：局域网/Tailscale 直连，或经 Cloudflare relay（主机已有完整机制，
手机客户端在用）。Web 端复用同一机制，具体接入配置**未确认**（待定）。

## 2. 关键设计

1. **传输层复用**：桌面端 `host-client.ts` 已把传输抽象为 `HostTransport`
   （`call` + `stream`）。Web 端只需实现 `ChannelTransport`，上层
   `HostClient` / `AppModel` / `BotStore` 逻辑全部复用。
   分层契约（ADR-001）：禁止 import 桌面端 renderer 源码，只依赖
   `@codync/shared` 类型。
2. **权限边界在主机执行**：无需中间层白名单。48 个 `LOCAL_ONLY` 方法对设备
   调用一律 403，清单固化在 `@codync/shared` 的 `LOCAL_ONLY_METHODS`
   （配套 `isLocalOnly()` / `deviceMayCall()`）。详见
   [API 参考 §5](api-reference.md)。
3. **同步模型**：每次变更盖全局递增 `rev`；客户端追平后转实时，按 id upsert，
   不可解码的事件不能跳过（回退 rev 0 重追）。Web 端与手机/桌面端同规则。
4. **端到端加密**：握手与帧格式见 [API 参考 §5.1](api-reference.md)；
   加密实现以官方向量回归（向量文件
   `docs/reference/fixtures/remote-relay-vectors.json`，测试用副本在
   `src/client/transport/channel-crypto.vectors.json`）。
   断线重连按 close code 分流（已实现于 `channel-transport.ts`）：
   4001 限次重试、4003/4410/4400 终止、4008 加倍退避、4011 立即重连。
5. **依赖边界**：`@noble/ciphers`（ChaCha20-Poly1305，WebCrypto 不支持）、
   `@noble/curves`、`@noble/hashes` 挂在 Web 客户端；
   `@codync/shared` 保持**零运行时依赖**（ADR-001）。

## 3. 代码结构（`web/` 现状，2026-11-03）

| 路径 | 内容 | 负责人/状态 |
|------|------|------------|
| `app/client/` | 客户端路由：`/client` 连接页（演示模式 + 真实主机表单）、`/client/chat` 工作区（BotRoster + ThreadView + Composer + 连接徽标）、`/client/{bots,settings}` Phase 2 占位 | 希音，`29743ed` |
| `src/client/transport/` | `host-transport.ts`（`HostTransport` 抽象 + `HostError` + close-code 决策类型）、`channel-crypto.ts`（hs1Input、transcriptHash、HKDF 方向密钥、ChaCha20-Poly1305 seal/open、Sealer/Opener，字节布局对齐 `crypto.rs`）、`channel-transport.ts`（`/channel` 直连：hello→welcome 验签→加密帧 RPC + 订阅事件）、`bytes.ts`（base64url 无填充转换）、`device-key.ts`（WebCrypto non-extractable Ed25519 优先 → noble 种子 AES-GCM 包裹 → 内存兜底；文件头明示「不抗同源 XSS」边界）、`pairing-url.ts`（解析 `codync://pair?v=3`，带 `sk` 强校验 welcome 防中间人）、`mock-transport.ts`（演示/测试假主机）；向量副本 `channel-crypto.vectors.json` | 希音，`29743ed` + Phase 1（`3f6a918..1ff4bd7`） |
| `src/client/store/` | `app-model.ts`：单主机远程模式，rev 游标、按 id upsert、resync 从 0 重追（砚台 sync 契约）；Phase 1 增加乐观发送（clientNonce 替换）、历史分页（beforeSeq 游标）、markRead | 希音 |
| `src/client/use-app-model.ts`、`components/`、`views/` | React 接入（useSyncExternalStore）与视图：`views/connect/ConnectForm.tsx`（演示 / 配对链接粘贴 / 已配对直连三入口）、`views/roster/BotRoster.tsx`、`views/thread/`（`ThreadView`、`Composer`、`markdown-blocks.ts` 纯块解析与桌面端同构、`markdown.tsx` 行内渲染、`message-bubbles.tsx`、`permission-card.tsx`、`attachment-list.tsx`、`composer-files.ts`） | 希音 |
| `packages/shared/` | `@codync/shared` 0.1.0：`models.ts`（实体类型+纯函数）、`api-types.ts`（API 契约 + `/channel` 线类型），零运行时依赖 | 砚台，typecheck 通过 |
| `docs/` | 本目录 | 榫卯 |
| `test/` + `vitest.config.ts` | 测试配置 | 试金 |
| `content/` | 上游用户手册（Mdx） | 上游既有 |

> 早期方案的 `relay/`（持 token PoC）与 `bridge/`（空壳）已随工作区定档删除；
> ADR-001 下**不存在中间层**，见到相关引用即为过时文档。

## 4. 模块映射（桌面端 → Web 端）

| 桌面端模块 | Web 端对应 | 说明 |
|-----------|-----------|------|
| `shared/host-client.ts` | `ChannelTransport` | 传输层换为 `/channel` WebSocket，接口不变 |
| `shared/ipc.ts` | Web 环境接口层 | `window.codync` bridge 不存在于浏览器 |
| `shared/models.ts` | `@codync/shared` `models.ts` | 已提取完成 |
| `store/app-model.ts` 等 | 同名模块 | 状态管理复用，主机管理简化为单主机远程 |
| `views/thread/*`、`views/bots/*` | 同名视图 | Phase 1 核心 |
| `views/settings/*` | 精简版 | 设备/云等本机专属设置不进 Web |
| `views/computer-access/*`、`views/island/*` | 暂不实现 | 依赖本机屏幕权限/系统窗口 |

## 5. 与其他端的一致性

按上游规则，任何 UI 变更需同步 iOS / Android / 桌面 / TUI 各端
（详见仓库根 AGENTS.md「Cross-platform UI changes」）。Web 端作为新客户端，
功能对齐以桌面端为准；平台专属能力（托盘、本地语音引擎、屏幕控制）不进 Web 端。

## 6. 配对约束（主机现状，2026-11-04 更新）

| 约束 | 依据 | 现状与对策 |
|------|------|-----------|
| 配对平台白名单（原只收 `ios\|macos\|android`，`web` 被 400 拒） | `host/src/remote/channel/pairing.rs:35` | **已放行 `web`**（`f028e75`，additive：`platform` 仅用于 analytics 与设备列表显示，不影响 `let_in` scopes）。客户端按 `platform: web` 登记（`fc4ad0f`），对未升级主机自动回退报 `macos` 一次（仅登记显示，不提权）；白名单改动属主机 shipped code，须随版本 bump 发布 |
| 配对要求云签发的设备证书，缺失 → `Refusal::Missing` → `RejectCode::UnsupportedVersion` → close 4400 | `host/src/remote/certificate.rs`（`check()`）、`channel/pairing.rs:83` | 正式链路（云登录 → 云签发证书 → `pair`）属 Phase 2；连接页留有证书 JSON 粘贴栏。无云/私有部署可用 `CODYNC_DEVICE_CERT_KEY` 自签证书（`certificate.rs:41-45`），见 [ADR-001 后果节](adr/001-channel-e2e.md) |

## 7. 阶段规划（摘要，详见 CLIENT_DEV_PLAN.md）

- **Phase 0**：脚手架 + ADR-001 决策 + 架构评审（已完成，`29743ed`）
- **Phase 1**：远程连接、Bot 列表、消息收发、历史、文件上传、配对认证（已入库 `3f6a918..1ff4bd7`，真实主机联调待做）
- **Phase 2**：Bot CRUD、设置、用量统计、Artifact、Marketplace（**进行中**——
  需求见 [phase2-user-stories.md](phase2-user-stories.md) 与
  [phase2-features.md](phase2-features.md)；规划新增模块（未实现，路径以实现为准）：

  ```
  web/src/client/views/bots/       # Bot 表单（新建/编辑）与列表操作
  web/src/client/views/settings/   # 设置面板
  web/src/client/views/search/     # 搜索面板（本地过滤，跨历史搜索待主机 API，未决）
  ```
  ）
- **Phase 3**：终端、语音、网络管理、屏幕查看、PWA
