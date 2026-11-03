# Codync Web 客户端架构设计

> **ADR-001 已生效**：浏览器直连主机 `/channel` 端到端加密通道，无中间层。详见 `docs/ADR-001.md`。

## 最终架构（ADR-001）

```
┌─────────────────────────────────────────────────────────┐
│              Web 客户端 (Browser)                         │
│  Next.js 16 + React 19 + Tailwind CSS                    │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐  │
│  │ Chat    │  │ Bot      │  │ Settings│  │ Marketplace│  │
│  │ Window  │  │ Roster   │  │ Panel   │  │ & Library │  │
│  └────┬────┘  └────┬─────┘  └────┬────┘  └─────┬─────┘  │
│       │             │             │              │         │
│  ┌────▼─────────────▼─────────────▼──────────────▼─────┐  │
│  │         ChannelTransport (E2E 加密层)               │  │
│  │  X25519 握手 · Ed25519 签名 · ChaCha20-Poly1305 帧   │  │
│  │  @noble/curves + @noble/ciphers                     │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │ WebSocket (wss://host:19222/channel?v=1)│
└─────────────────────────┼─────────────────────────────────┘
                          │ 端到端加密
┌─────────────────────────┼─────────────────────────────────┐
│              codync-host (Rust, port 19222)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ /channel │  │ E2E 解密 │  │ permit() │  │ 业务逻辑 │  │
│  │ WebSocket│  │  帧验证  │  │ 权限边界 │  │ Bot/Chat │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 核心挑战与解决方案

| 挑战 | 解决方案 |
|------|----------|
| 主机 `/api/*` 仅 loopback 可访问 | 走 `/channel` E2E 通道（与手机客户端同协议） |
| 浏览器不支持 ChaCha20-Poly1305 | `@noble/ciphers` pure JS 实现 |
| X25519/Ed25519 握手 | `@noble/curves`（WebCrypto 支持但用 noble 统一） |
| 配对流程 | 复用主机 `pairing` 机制，浏览器作为新设备配对 |
| 测试向量 | `docs/reference/fixtures/remote-relay-vectors.json`（12 组官方向量） |
| Close code 重连策略 | 4001/4003/4008/4400/4410 → 差异化 UX |
| 权限边界 | 主机 `permit()` 控制，48 个 LOCAL_ONLY 方法 Device 不可达 |

### 数据流设计

1. **配对**: Web 客户端输入配对码 → `/channel` 握手（X25519 + Ed25519）→ 主机验证 → 设备注册
2. **事件流**: 加密 WebSocket 订阅 → `Subscribe` 消息 → 主机推送加密事件帧
3. **命令**: `Request` 消息（加密）→ 主机 `dispatch()` → `Reply`（加密）
4. **文件上传**: 加密帧内 base64 分块 → 主机 `upload` 方法

### 模块映射

| 桌面端模块 | Web 端对应 | 变更说明 |
|-----------|-----------|---------|
| `host-client.ts` | `client/channel-transport.ts` | 实现 /channel E2E 协议 |
| `store/app-model.ts` | `store/app-model.ts` | 适配远程连接，无本地主机管理 |
| `store/bot-store.ts` | `store/bot-store.ts` | 基本不变 |
| `store/bot-sync.ts` | `store/bot-sync.ts` | 通过加密事件同步 |
| `store/account.ts` | `store/account.ts` | 适配 Web 配对流程 |
| `views/thread/*` | `views/thread/*` | 核心聊天功能，保留 |
| `views/bots/*` | `views/bots/*` | Bot 管理功能，保留 |
| `views/settings/*` | `views/settings/*` | 精简本地相关设置 |
| `views/call/*` | `views/call/*` | 语音使用 Web Speech API |
| `views/computer-access/*` | 暂不实现 | 需要本地屏幕权限 |
| `views/island/*` | 暂不实现 | 需要系统级窗口管理 |
| `shared/models.ts` | `@codync/shared` | 已提取为共享包 |
| `shared/network.ts` | `@codync/shared` | 已包含 |

### 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS + TypeScript
- **加密**: `@noble/curves` (X25519, Ed25519) + `@noble/ciphers` (ChaCha20-Poly1305) + `@noble/hashes` (HKDF-SHA256)
- **共享包**: `@codync/shared`（纯类型 + 纯函数，零运行时依赖）
- **测试**: Vitest（单元）+ Playwright（E2E），官方向量回归
