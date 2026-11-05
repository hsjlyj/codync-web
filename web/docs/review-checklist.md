# Web 客户端代码审查标准（PR 审查清单）

**适用范围**：Codync Web 化项目所有 PR，依据 ADR-001（方案 A /channel E2E）与 CLIENT_ARCHITECTURE.md

## 1. 架构一致性 [必须]

- [ ] 走 `/channel` E2E 通道，不直接调用主机 HTTP API
- [ ] 实现 `RemoteTransport implements HostTransport`，上层逻辑复用桌面 `HostClient/AppModel`
- [ ] 未直接 import 上游桌面客户端源码（`apps/desktop/src/renderer/`，本仓库已移除），仅依赖 `@codync/shared` 类型
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

### app-model 拆分复审 — `8795333` + `03a87a1`（2026-11-04）

**结论：通过，纯搬移属实，无 [BLOCK]**。我亲跑 HEAD：tsc exit 0、vitest **75/75**（12 文件；期间一次 74/75 为已知的 `bytes.test.ts` chunk 边界 flaky，重跑即绿）。

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 文件行数达标 | ✅ | app-model.ts 245 行（原 540）；entry-state 257 / real-host 104 / bot-state 48 / snapshot 38，均 <500 |
| 无运行时循环 import | ✅ | 依赖单向 app-model → {bot-state, entry-state, real-host, snapshot}；real-host 对 app-model 为 `import type`（编译期擦除，无运行时环） |
| 对外 API 不变 | ✅ | app-model 仍导出全部公开方法（connect/connectRealHost/forgetDevice/disconnect/respondPermission/markRead/sendMessage/uploadFiles/loadHistory/readUploadBytes…）并 `export type { AppSnapshot, ConnectionState }`；视图与 `app-model.test.ts` 零改动 |
| 委托语义一致 | ✅ | `changed()` 快照通知语义原样保留；删除事件收窄逻辑在 bot-state 内原样搬移 |
| vitest 不误收 e2e | ✅ | `03a87a1` 给 vitest.config.ts 加 `exclude: [..., 'e2e/**', 'playwright-report/**']`，Playwright 归 Playwright |
| [SUGGESTION] | 🟡 | `real-host.ts` 用 `import type { AppModel }` 打破环是安全做法；若未来需要运行时引用，应改为窄接口注入而非直接 import 类 |

---

## Phase 3 审查口径（2026-11-04 起生效，待产出逐条核对）

Phase 3 引入三类浏览器重资源，**资源清理是 [BLOCK] 级检查项**：

### 8. 终端（xterm.js）
- [ ] `Terminal.dispose()` 在组件 unmount 时调用（useEffect cleanup）
- [ ] term 订阅取消（`{"id","cancel":true}`）在关闭面板时发出，流 `end` 后清理
- [ ] base64 输出 decode 后写入，超大输出是否截断（xterm buffer 上限）
- [ ] `termInput`/`termResize` 防抖，避免每 keystroke 一帧

### 9. 屏幕共享（WebRTC）
- [ ] `RTCPeerConnection.close()` 在离开会话/出错时调用，`ontrack` 引用解除
- [ ] ICE 候选订阅（`screenCandidates`）结束后取消；viewer 上限 32/4/60s 由主机兜底，客户端重复点击要防抖
- [ ] `screenOffer` 传裸 SDP 字符串（砚台 dbcf53d 核实），不是 RTCSessionDescription 对象
- [ ] video 元素 srcObject 置 null 释放

### 10. 语音（Web Speech API / 临时凭据）
- [ ] `SpeechRecognition.stop()` + `onend` 后清 handler，组件卸载不留活 recognition
- [ ] `voiceSession` 临时 credential 不写入持久化存储、不进日志
- [ ] 音频 MediaStream track 全部 `stop()` 后再释放

### 通用
- [ ] 每个 Phase 3 新文件 <500 行（mock-transport.ts 已 519 行，加功能前先拆——若光已提醒希音）
- [ ] 无新的 `any`、无 console 泄露（含 credential）
- [ ] 新功能有单测；协议行为以砚台 dbcf53d 类型为准
- [ ] 无新的 [BLOCK]：尤其资源泄漏、凭据落盘、订阅不取消

### Phase 3 任务 A 审查 — `e3f89be`→`1555d6f`（2026-11-04）

**结论：通过，无 [BLOCK]**。我亲跑 HEAD：tsc exit 0、vitest **95/95**（16 文件；首次跑 94/95 为已知 `bytes.test.ts` flaky，重跑即绿）。逐条核对希音给的锚点，全部属实：

| 红线项 | 结果 | 证据 |
|--------|------|------|
| xterm dispose on unmount | ✅ | TerminalView.tsx:80-84 cleanup 顺序 `controller.stop()`（发 cancel+termClose）→ `term.dispose()`；ResizeObserver disconnect；xterm 动态 import 避开 SSR；scrollback 5000 行兜底 |
| term 订阅取消 | ✅ | `TerminalController.stop()`（terminal.ts:92-109）幂等：先退订再 termClose；输入微批 queueMicrotask 合并 |
| WebRTC pc.close | ✅ | screen-view.ts `stop()`/`fail()` 双路径都幂等走 退订+`pc.close()`+`screenClose`（测试断言 screenClose 恰一次） |
| srcObject 释放 | ✅ | ScreenShareView.tsx:44 cleanup `video.srcObject = null` |
| 信令顺序 | ✅ | prepare → **先开 screenCandidates 订阅** → offer（裸 SDP 字符串 :99）→ answer（:84-102），与 signaling.rs:134 硬约束一致 |
| 本地候选方向 | ✅ | 经 `screenCandidate` 请求上送（:166），`pc.addIceCandidate` 只用于下行（:187）；串行冲刷链防 complete 乱序（:152-157） |
| 403 用户话术 | ✅ | describeScreenError 映射「缺少 Screen scope」（:226-230），非鸭子探测 |
| SpeechRecognition 清理 | ✅ | speech-input.ts stop() 先摘 onresult/onerror/onend 再 stop；Composer.tsx:51 unmount 兜底 `speechRef.current?.stop()`；SSR 安全（speechSupported 查 window）；无 credential 处理面 |
| mock 拆分纯搬移 | ✅ | `e3f89be` 仅把目录树搬入 mock-dirs.ts，MockTransport 接口零变化（diff 无 export 签名增删）；mock-transport 519→460 行达标 |
| 无 any / 日志泄露 | ✅ | 7 个新文件 grep `as any\|console.log` 零命中 |
| 文件行数 | ✅ | 最大 screen-view.ts 230 行，全部 <500 |
| /screen-candidates 路由 | ✅ | parseStreamPath :504-505 已支持，sub=`screenCandidates` |

### 仓库精简与引用修正审查 — `55a4c96`（3584→586 文件）+ `22a4105`（2026-11-05）

**结论：无 [BLOCK]，可推送。** 取舍依据成立：编译期依赖零缺失、保留集最小且必要、门禁全绿。待改 4 项，均为 [SUGGESTION]。

**审查前提（记录在案）**：审查时共享工作树停在 `ci/host-verify`（= `feat/web-client` + 新增 `.github/workflows/host-ci.yml`，不在 `web/` 下、不影响构建）。已确认 `55a4c96`、`22a4105` 均为 `feat/web-client` 的祖先，两树差异仅该 workflow 文件，故门禁结论对 `feat/web-client` 同样成立。

#### Q1 编译/构建依赖面 —— 8 类穷举，无一处伤到

| 依赖形式 | 结果 |
|---|---|
| `include_str!`/`include_bytes!` | 全仓 16 处，按「相对该文件所在目录」逐条解析 → **16/16 存在、0 缺失** |
| `build.rs` / `.cargo/config` / `include!` / `doc=include_str!` | **0 个** |
| Cargo `path` 依赖 / workspace members | 仅 `crates/memory`、`crates/network`，**均在**；仓库根无 workspace `Cargo.toml` |
| `#[path = ...]`（10 处） | 全部指向 `host/` 内既有文件，无一指向被删目录 |
| 运行期 `std::fs` 读仓库内文件 | **无**（host/src 下为 `:memory:` 或 `data_dir()`，无仓库相对路径） |
| `env!("CARGO_MANIFEST_DIR")`（24 处） | 全部指向 `host/tests/` 下既有 fixture（`fake_agent.py`、`tests/fixtures/*.py`、`wire-shape.json` 均在） |
| 编译期目录宏（`sqlx::migrate!`/`include_dir!`/`rust-embed`/`cc::build`/`tonic_build`） | **均为 0** → 无迁移目录、无嵌入目录依赖 |
| 宿主调外部脚本（`python3`/`node`/`bash`） | host/src 内为 **0** → 不依赖被删的 `packaging/*.py`、`tools/` |

另：全部 `.rs` 都在 `host/` 下（`git ls-files '*.rs'` 反查为空）。

**最易踩空处单独验**：`host/tests/e2e.rs:12` 用 `#[path = "../src/remote/crypto.rs"]` 把 crypto.rs 收进测试，其 `include_str!("../../../docs/reference/fixtures/remote-relay-vectors.json")` 仍按**文件真实位置**解析到保留文件 → 保留正确。

#### Q2 保留集最小且必要 —— 成立
- 语言 json：`git ls-tree 55a4c96^` 计 **9**，删后 **9**，9 个全部被 `l10n.rs:81-121` 逐个引用 → **最小且必要，无冗余混入**
- `packaging/`：**13→1**，仅剩被 `release.rs:12` 引用的公钥
- `docs/reference/fixtures/`：**3→3**。仅 `.json` 是编译依赖（`crypto.rs:333`）；`.py` 实测在隔离 venv 中可重建出**逐字节相同**的 `.json`（6462 B）→ 可复算 fixture，保留合理
- `.github/FUNDING.yml` 仍在（workflows 已删），无害

#### Q3 引用修正不彻底 —— 同类残留 38 处（`22a4105` 只覆盖 `apps/desktop` 一类 6 处）

- **3 条断裂 markdown 链接**（脚本全仓复跑：28 份 md、65 条相对链接、**3 条断**）：`SECURITY.md:29 → private-relay/README.md`、`TRADEMARK.md → cloud/`、`docs/reference/fixtures/README.md → ../remote-relay.md`
- **34 处 `host/` 内注释**（28 个文件）：`docs/plans/require-sign-in.md` 7、`docs/design/bot-memory.md` 6、`docs/reference/compatibility.md` 5、`docs/reference/{remote-relay,analytics-events}.md` 各 2、`docs/plans/voice-architecture.md` 2、`docs/architecture/connections.md` 2、`packaging/cua-driver/*` 3、`cloud/src/*` 2、`apps/{desktop,screen-linux}` 2、`private-relay/` 1
- **1 处非 host**：`web/eslint.config.mjs:16` 的 `"public/demo/**"` 已失效
- 定性：34 处**全为注释/文档，无一处参与编译或运行**（逐条确认不在 `include_str!`、不在路径常量）。本机无 cargo → 属**「读代码确认」非「编译确认」**；但 rustdoc 默认不对 markdown 文件链接报错，`cargo build/test` 亦不检查 → **不构成编译风险，全为 [SUGGESTION]**
- `host/rust-toolchain.toml:2-3` 特殊：它是**已不可执行的维护指令**（「与 `apps/screen-linux/rust-toolchain.toml` 保持一致」「改两个、跑两个」），现仅存一个 toolchain 文件 → 比断链更该改

#### Q4 门禁 —— 本审查亲跑，未引用他人数字
```
npx tsc --noEmit   → exit 0
npx vitest run     → Test Files 16 passed / Tests 95 passed / exit 0（27.50s）
npx next build     → exit 0，Generating static pages (13/13)，11 条路由全 Static
```
`web/` 下 md：**20 份、0 断链**。若光报「21 份」的差异已查明：删前确为 **21** 份（多一份 `web/README.md`，被本提交删除），删后 20 份仍 0 断链 → 结论成立，数字应为 20。

#### 建议（按性价比，均不阻塞推送）
1. [SUGGESTION] 修 3 条断裂链接（`SECURITY.md`/`TRADEMARK.md` 会被外部看到）
2. [SUGGESTION] 改 `host/rust-toolchain.toml:2-3` 两行注释
3. [SUGGESTION] 其余 30 处同类注释可批量后置
4. [SUGGESTION] 删 `web/eslint.config.mjs:16` 失效 ignore

### `host CI` 工作流审查（`ci/host-verify`，`37580ab`）（2026-11-05）

**结论：可以留作常驻门禁；与「最小仓库」原则不冲突。** 当前形态 3 项待补、2 项硬化建议。

**不冲突的理由**：精简的原则不是「文件少」，而是「每一项保留必须在当前仓库里有可执行的作用」。该工作流是**本机无 cargo 情况下唯一可持续验证 host 编译**的机制，而 host 是本次保留的两大组件之一。原始删除是**按目录整删**，host CI 恰是该目录里唯一有用项 → 「留一个」不是破例，是修正按目录粗删。

**留得住的三个条件**：① 只此一个、纯验证不发布 —— **已核**：无 `secrets.*`、无 upload、无 release、无 token，文件第 5 行自述 "verification only — it ships nothing" 为真；② 不得把 `packaging/`、`tools/` 带回来 —— **已核**：仅 `rustup` + 四步 cargo，未引用任何被删脚本；③ **待补**：`main` + `pull_request` 触发。

- **[SUGGESTION] `branches:` 缺 `main` 与 `pull_request`**（浮生已认领）。精确事实：仓库**默认分支是 `feat/web-client`**（GitHub API 核实），`main` 落后 77 个提交且非默认 → 现有过滤覆盖了当前开发主线，`main` 只在成为发布分支时才必需。另：若日后设为 **required status check**，`paths:` 过滤会使仅改 `web/**` 的 PR 不产生该检查，需一并处理，否则可能卡住合并。
- **[SUGGESTION] 环境步骤改 best-effort 后缺正向断言**：`continue-on-error: true` + 全链 `|| true`（:47-52）会让「真缺包」静默通过，错误推迟到 cargo 阶段且更难读。建议加 `command -v cmake`、`pkg-config --exists openssl` 断言，让环境问题在环境步骤亮红。
- **[SUGGESTION] 未声明 `python3` 依赖**：`cargo test --workspace` 的 e2e 用 `python3` 跑 `tests/fake_agent.py` 等（`host/tests/common/mod.rs:90`、`:95-100`），环境步骤只装 cmake/pkg-config/libssl-dev。ubuntu-latest 自带 python3 故现在能过，作为常驻门禁建议显式断言 `python3 --version`。
- **[SUGGESTION] 第三方 action 建议按 SHA 固定**：`Swatinem/rust-cache@v2` 按 tag 固定；公开仓库无 secrets、风险低，硬化惯例是固定 commit SHA。

**未验证（如实标注）**：Rust 编译与 `cargo fmt/check/test/clippy`（本机无 cargo，交由 `ci/host-verify` 在 GitHub runner 上验）；`remote-relay-vectors.py` 无法用系统 Python 跑（PEP 668 externally-managed），改用 `/tmp/vvenv` 隔离 venv 才验成逐字节一致。

### 补充：文档回归的基线对照（`feat/web-client`，2026-11-05）

**目的**：证明「这次精简引入的文档回归**有且只有 3 处，没有第四条**」。

| 参照点 | md 份数 | 相对链接数 | 断链数 |
|---|---|---|---|
| `14f0916`（精简前基线） | 145 | 574 | **0** |
| `feat/web-client`（含 `7229660`：精简 + 引用修正 + 本记录） | 28 | 65 | **3** |
| 同上、`web/` 子集 | 20 | 40 | **0** |

三条断链全在 `web/` **之外**，与 `22a4105` 未覆盖的同类残留是同一组：`SECURITY.md:29 → private-relay/README.md`、`TRADEMARK.md → cloud/`、`docs/reference/fixtures/README.md → ../remote-relay.md`。

**验收标准**（若光定死）：最终 tip —— 定义是「榫卯 文档修复 + 渡口 主机端修复全部落盘、取完 workflow 之后的那一个 SHA」——必须 **0 断**。链接检查**按 commit 生效**，必须在最终 SHA 上重跑，旧结论不作数。

**方法（可复现）**：`git ls-tree -r --name-only <ref>` 取该 commit 文件集；逐份 `git show <ref>:<path>` 读 markdown；正则 `\[([^\]]*)\]\(([^)\s]+)\)` 取相对链接（跳过 `http(s):`/`#`/`mailto:`/`tel:`）；用 posixpath 按该文件所在目录归一化后，在**同一 commit 的文件集**里判存在（目录链接按前缀判，避免误报）。脚本：按 commit 版 `/tmp/linkcheck_ref.py`、工作区版 `/tmp/linkcheck.py`。

**中间验证（榫卯 尚未提交时的预检）**：其 5 处修复 + README 重写的**工作区**版本 = **28 份 / 68 条 / 0 断**（README 重写新增 3 条链接），`web/` 子集 20 份 / 40 条 / 0 断 → 落盘后即可达标。渡口 的改动只涉及 `host/src/remote/pairing_requests.rs`（`.rs`，非 `.md`），不影响该计数。

**方法学说明**：本次口径与前一轮一致（同一正则、同一跳过规则、同一归一化），因此「0 → 3」这一变化可直接归因于 `55a4c96`，而不是口径变化。旧口径只做「是否存在」判断，未区分目录链接；新口径增加了目录前缀判定，故对 `cloud/` 这类目录链接的判定更严格 —— 复查 `14f0916` 在两种口径下均为 0 断，结论不受影响。
