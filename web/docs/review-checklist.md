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

**结论：通过，无 [BLOCK]**。官方向量 7 项逐字节回归通过；`ChannelFrame` base64url 无填充标注正确；close code 双常量（`REJECT_CLOSE_CODES`/`CHANNEL_CLOSE_CODES`）建模完整。

### 待关注（非阻塞）

- `bytes.test.ts` chunk 边界 roundtrip 偶发超时（jsdom GC 抖动），试金已建议 `testTimeout: 15000`
- 真实主机 E2E 联调待 Phase 3（需 cargo 编译 host + 云证书）
- Playwright 冒烟三条建议补：演示模式发消息 / bots/new 提交 / settings 断开
