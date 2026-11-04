# Web 客户端代码审查标准（PR 审查清单）

**适用范围**：Codync Web 化项目所有 PR，依据 ADR-001（方案 A /channel E2E）与 CLIENT_ARCHITECTURE.md

## 1. 架构一致性 [必须]

- [ ] 走 `/channel` E2E 通道，不直接调用主机 HTTP API
- [ ] 实现 `RemoteTransport implements HostTransport`，上层逻辑复用桌面 `HostClient/AppModel`
- [ ] 未直接 import `apps/desktop/src/renderer/` 源码，仅依赖 `@codync/shared` 类型
- [ ] 不持有主机 Bearer Token，device key 由浏览器生成并在内存中持有

**证据**：检查 `ChannelTransport` 实现、依赖树，无 `http://127.0.0.1:19222/api` 直连

## 2. 安全性

- [ ] 握手流程符合 channel.rs:231-309：hello → welcome，验证 Ed25519 签名 + X25519 密钥交换
- [ ] 帧加密使用 ChaCha20-Poly1305（`@noble/ciphers`），AAD=`codync/frame/v1`+计数器
- [ ] device key 不写入 localStorage，明文只在内存，必要时用 WebCrypto non-extractable
- [ ] Origin 校验、WebSocket 消息大小 ≤ 1MiB、配对码限流 10min/5次/3次
- [ ] LOCAL_ONLY 方法不透出：`LOCAL_ONLY_METHODS` 常量映射，Web 端天然不可达

**必须改**：若发现持有主机 token 或修改 `authorized()` 放行非 loopback，直接 BLOCK

## 3. 类型与数据契约

- [ ] 使用 `@codync/shared/src/models.ts` 与 `api-types.ts`，无类型漂移
- [ ] `REJECT_CLOSE_CODES` 4001/4003/4008/4400/4410 处理正确，重连策略明确
- [ ] `HostEvent`、`Bot`、`Entry` 等核心类型与桌面端一致

## 4. 性能

- [ ] RemoteClient 重连指数退避，SSE/WebSocket 订阅去重
- [ ] 渲染层 `useMemo`/`useCallback` 避免 Bot/Entry 列表重复渲染
- [ ] 无内存泄漏：unsubscribe/AbortController 在组件卸载时清理

## 5. 可测试性

- [ ] 单元测试覆盖 RemoteClient 连接/断开/重连、AppModel 状态流转、认证流程
- [ ] E2E 用 Playwright 覆盖消息发送/接收、配对码流程
- [ ] Phase 1 核心模块 ≥80%，整体 ≥60%

## 6. 代码质量

- [ ] TypeScript 严格模式，禁止 `any` 透传
- [ ] 错误处理统一映射 `CallError`，用户可操作的提示
- [ ] 命名、风格与现有代码库一致，PR 描述按 Conventional Commits

## 7. 文档

- [ ] `docs/api-reference.md` 同步更新（如新增方法/字段）
- [ ] 变更涉及权限边界，需在 ADR-001 引用章节说明影响

### 审查标记

- `[BLOCK]` 必须改
- `[SUGGESTION]` 建议改

**评审流程**：创建 pending review → 行级评论 → 提交 review。不要批准自己提交的 PR。

---

## 审查记录

### Phase 2 审查 — `92a9e03..d9f34df`（9 提交，2026-11-04）

**结论：通过，无 [BLOCK]**。tsc 0 错、vitest 73/73、next build 成功、eslint 0 警告（复核人：新刃）。

| 清单项 | 结果 | 证据 |
|--------|------|------|
| 架构一致性 | ✅ | 全部经 `ChannelTransport` 走 `/channel`；仅 import `@codync/shared` 类型；无 Bearer Token；无主机 HTTP 直连 |
| 安全性 | ✅ | device key 三档存储（WebCrypto non-extractable 优先），`grep localStorage` 在 src/app 下零命中；settings 页只展示密钥形态不展示密钥本身 |
| 类型契约 | ✅ | `BotDraft`/`Artifact`/`LibraryItem` 全部来自 `@codync/shared`；`grep "as any\|: any"` 在非测试源码零命中 |
| 删除事件收窄 | ✅ | `92a9e03` 按 `hub.rs:294` 只认 `{id, deleted:true}`，不进 upsert，有专属测试 |
| 方法名事实 | ✅ | `deleteBot({botId})`、`reorderBots({ids})`、`updateBot` 带 `id`、`renameSection({from,to})`，与砚台 `06c8e3c` 核实一致 |
| 静态导出约束 | ✅ | 编辑页用 `?bot=<id>` 查询参数，无 `[id]` 动态路由段 |
| 文件大小 | ⚠️ [SUGGESTION] | `app-model.ts` 已达 540 行（超 500 行约定）；本轮只新增 11 行，建议 Phase 3 拆分时把事件处理/连接管理拆出 |
| 日志泄露 | ✅ | 非测试源码无 `console.log/debug/info` |
| 测试覆盖 | ✅ | 新增 4 个测试文件（bot-admin 10 例 / library 3 例 / search 7 例 / roster-groups 4 例），累计 73/73 |

### Phase 0+1 审查 — `4a2f6ef` / `8b9bedc` / `29743ed` / `3f6a918..1ff4bd7`（2026-11-03）

**结论：发现 [BLOCK] 一处，其余通过**。官方向量 7 项逐字节回归通过；`ChannelFrame` base64url 无填充标注正确；close code 双常量（`REJECT_CLOSE_CODES`/`CHANNEL_CLOSE_CODES`）建模完整。

#### 🔴 [BLOCK] `channel-transport.ts` 握手状态丢失：`lastHello` 从未赋值 — ✅ 已修复

- **证据**：`sendHello()`（channel-transport.ts:221-249）只给 `this.ekPrivate` / `this.helloDk` 赋值，**没有设置 `this.lastHello`**；而 `acceptWelcome()` 第 271 行 `if (!dk || !hello || !this.ekPrivate)` 中 `hello = this.lastHello` 永远为 `null` → 真实连接时 welcome 永远以 `protocolError / 握手状态丢失` 关闭，握手不可能成功。
- 第 356 行 `this.lastHello = this.lastHello ?? null` 是无操作残行，疑似原本想在此/彼处赋值但写丢。
- **为什么测试没抓到**：`channel-transport.test.ts` 只测 `closePolicyOf` 纯函数，没有 mock socket 走 `sendHello → acceptWelcome` 完整路径；73/73 全绿不覆盖传输层状态机。
- **修复**：在 `sendHello` 构造 `hello` 后加 `this.lastHello = { ek: hello.ek, n: hello.n }`，并删除第 356 行残行；补一条 mock-WebSocket 握手集成测试（hello → welcome → 能发一帧 RPC）。
- **责任人**：@希音
- **复审（2026-11-04，`a389f73..3c93208`）**：✅ `a389f73` 在 sendHello 内 `this.lastHello = { ek: hello.ek, n: hello.n }` 赋值正确，残行已删；`24aa225` 新增 2 条 mock-WebSocket 握手集成测试（正路径 hello→welcome→帧双向可解、负路径 welcome 签名不符→拒绝+中间人提示），传输层状态机覆盖补上。我亲跑 HEAD：tsc 0 错、vitest **75/75**。**BLOCK 解除**。

#### 🟡 [SUGGESTION] `hostSignKey` 可选留下中间人窗口 — ✅ 已落实

`ChannelOptions.hostSignKey?` 为可选（channel-transport.ts:63），不传则跳过 welcome 签名校验（:274）。app-model 两处调用（:167/:205）都传了 `sk`，但手工直连表单如果允许不填主机公钥，攻击者可 MITM 握手。建议连接页在无 `sk` 时显式警告「未校验主机身份」。

- **复审**：✅ `3c93208` 在 ConnectForm 手工字段下加了警示（无 sk 时提示 welcome 签名校验跳过、建议用配对链接）。配对链接路径 `parsePairingUrl` 强制 sk 本就安全。建议关闭。

#### ✅ 通过项

- `device-key.ts` 三档存储边界在文件头明示（回退路径「不抗同源 XSS」），无 localStorage 明文
- `x25519.getSharedSecret`（noble）默认拒低阶点，对应 crypto.rs `was_contributory`
- 帧计数器 u64 在 JSON number 精度内（REKEY_AT=2³² < 2⁵³），`Opener` 严格连续计数器防重放
- `b64urlEncode` 分块 spread（0x8000）参数量安全
- onClose/teardown 挂起 Promise 全部落定（Phase 1 遗留 bug 已修）
- `pairing-url.ts` 强制 `id/sk/code` 三元组，`sk` 作为 welcome 强校验锚点

### 待关注（非阻塞）

- `bytes.test.ts` chunk 边界 roundtrip 偶发超时（jsdom GC 抖动），试金已建议 `testTimeout: 15000`
- 真实主机 E2E 联调待 Phase 3（需 cargo 编译 host + 云证书）
- Playwright 冒烟三条建议补：演示模式发消息 / bots/new 提交 / settings 断开

### 收尾审查 — `5f271eb..7a56487`（2026-11-04，审查范围至 HEAD）

**结论：无新 [BLOCK]**。HEAD（`7a56487`）代码面干净；工作树内希音的 app-model 拆分尚未提交（中间态 tsc 报 3 错属正常，提交时会消除）。

| 检查项 | 结果 | 证据 |
|--------|------|------|
| bot-admin 与 api-types 一致 | ✅ | `createBot(BotDraft)` / `updateBot` 强制 `id`（bot-admin.ts:32 抛错）/ `deleteBot({botId})` / `reorderBots({ids})` / `renameSection({from,to})`，与砚台 `06c8e3c` 核实口径一致 |
| Phase 2 代码（已 commit 部分） | ✅ | `92a9e03..d9f34df` 已在上文审查通过；其后 `a389f73`/`24aa225`/`3c93208` 已复审清退 |
| 无 sk 警示（3c93208） | ✅ | ConnectForm 手工路径下 amber 警示，`role="note"`，文案准确（welcome 校验跳过、建议配对链接） |
| Playwright E2E 骨架 | ⚠️ 骨架就位、未实跑 | `web/e2e/` 三条（demo-chat / bot-crud / settings），`playwright.config.ts` webServer 自动起 next dev；`--list` 可识别 3 条。**未执行过真实 run**（需 next dev 可启动），试金名下 untracked |
| app-model 拆分 | ⏳ 进行中 | 工作树可见 `bot-state.ts`(50L)/`entry-state.ts`(257L)/`snapshot.ts`(38L)/`real-host.ts`(104L) 草稿，app-model.ts 未提交版本已删 381 行；**提交后需复审循环 import 与 re-export 兼容性**（ConnectionBadge/use-app-model 依赖 app-model 的导出类型） |
| 循环 import | ✅ HEAD 无 | 当前依赖链单向：views → app-model → {bot-admin, transport/*} → @codync/shared |

**遗留动作**：① 希音拆分提交后我复审；② 试金把 Playwright 三条真正跑一遍并把结果贴群；③ 真实主机联调仍留 Phase 3。
