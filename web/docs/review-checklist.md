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
