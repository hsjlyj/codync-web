# Phase 3 功能清单与验收标准

> 更新：2026-11-04 · 维护：榫卯 · 分支：`feat/web-client` · 状态：**任务 A 已实现，真实主机联调未完成**
> 终端/语音/屏幕已入库（演示模式即可体验）；全部功能在真实主机上的端到端验证待做。
> 协议事实由希音/砚台 2026-11-04 源码核实，榫卯复核了标注的三处。

## 0. 事实基线（先读）

- **订阅机制**：`{"id","sub":"term","b":{"term":id}}` 开订阅；事件以 `{"id","ev"}`
  帧下发；结束 `{"id","end":true}`（`host/src/remote/channel/subscriptions.rs:96-109`）
- **term 事件内容**：`{"type":"output","data":<base64>}` 输出；
  `{"type":"exit","code":n}` 结束（exit 后流终止）
- **屏幕信令**：`screenPrepare` → `{session, iceServers, expiresAt, trickle}`
- **顺序约束（易错点）**：必须**先开 `screenCandidates` 订阅再发 `screenOffer`**
  （`host/src/screen/signaling.rs:134` 原文 "open screenCandidates before
  offering"，榫卯复核；砚台已补进类型注释与 [API 参考 §4.1](api-reference.md)）；
  trickle 协商失败时走完整 SDP 回退，不开订阅
- **信令方向教训**（实现期踩坑）：上行候选经 `screenCandidate` **请求**上送，
  下行候选才进 `pc.addIceCandidate`——两个口不能混
- **candidate 结构**（tagged enum）：`{"type":"candidate","candidate",
  "sdpMLineIndex","sdpMid"}` 或 `{"type":"complete"}`
- **语音权限**：`voiceStatus` / `voiceSession` / `voiceModels` / `voiceTranscribe` /
  `voiceSpeak` 设备可调；`setVoiceKey` 本机专属（[API 参考 §4.1](api-reference.md)）
- **网络管理受限**：`network*` 方法除 `networkView` 外全部本机专属
  （`host/src/api/network.rs:2`）——Web 端只能**只读查看**，管理操作回桌面端/主机

## 1. 功能状态

| 功能 | 状态 | 依据方法/能力 |
|------|------|--------------|
| 终端模拟器 | **已实现**（`39204e1`，演示模式可体验） | `agentSetup`（install/login）→ term 订阅 → `termInput` / `termResize` / `termClose` |
| 语音输入 | **已实现**（`872c236`，仅听写） | 浏览器 Web Speech API（纯本地识别，未用主机 voice*） |
| 屏幕查看 | **已实现骨架**（`1555d6f`，仅查看无输入） | `screenPrepare` / `screenOffer` + `screenCandidates` 订阅（WebRTC） |
| 网络查看（只读） | 规划 | `networkView`（其余 `network*` 本机专属，设备不可调） |

## 2. 验收标准（Given / When / Then）

### F1 终端模拟器（已按此实现，`39204e1`；真实主机联调待做）

- **Given** 已连接主机，存在待安装/待登录的 agent backend
- **When** 发起 `agentSetup` 并订阅 term 流
- **Then** 终端输出按 base64 解码实时渲染（xterm.js，scrollback 5000 行上限）；
  键入经 `termInput` 下发（微批合并）；尺寸变化经 `termResize`；流以 `exit`
  事件收尾且订阅关闭（cancel + `termClose`）；exit 后重订阅得 404（主机语义）

### F2 语音输入（已按此实现，`872c236`；真实主机联调待做）

- **Given** 浏览器支持 Web Speech API（不支持的浏览器不显示麦克风按钮）
- **When** 按住/点击语音输入并说话
- **Then** 中间结果（interim）实时上屏、最终结果（final）进 Composer 可编辑；
  当前实现为纯浏览器本地识别，不触碰主机 voice* 方法
- 不可在 Web 端配置 API key（`setVoiceKey` 本机专属）——配置入口在桌面端，
  界面需说明这一点

### F3 屏幕查看（已按此实现骨架，`1555d6f`；真实主机联调待做）

- **Given** 主机已开启屏幕能力
- **When** 打开屏幕查看
- **Then** 按事实基线的顺序完成信令（**先订阅 `screenCandidates`，再
  `screenPrepare`/`screenOffer`**），WebRTC 建流后画面渲染；本地候选缓冲到
  应答落地后按序上送、末尾发 `complete`；trickle 失败（`trickle:false`）不开
  订阅、走完整 SDP；关闭时幂等清理（退订 + `screenClose` 恰一次 + pc.close）
- 输入控制：**骨架只收流、不发送输入**；是否开放后续待定

### F4 网络查看（只读）

- **Given** 主机加入了多机网络
- **When** 打开网络页
- **Then** 展示 `networkView` 返回的对端与状态（只读）；不出现任何管理操作
  入口（创建/加入/邀请等均本机专属）

## 3. 已知限制

- **真实主机联调未完成**（需 cargo 环境）：终端/语音/屏幕在演示模式可用，
  真实主机上的端到端验证未做
- **屏幕**：骨架只收流、不发送输入（查看器范围）；输入控制是否开放待定
- **语音**：仅听写、无通话 UI；当前为纯浏览器本地识别，主机转写路径未接
- **终端**：`exit` 后流终止，重连需重新 `agentSetup`
- **网络**：仅规划中（只读查看）

## 4. 统一验收标准

沿用 [Phase 2 统一标准](phase2-features.md)（INVEST、<500 行、kebab-case、
vitest ≥80%、tsc 0 错、`next build` 通过、Conventional Commits、文档同改）；
涉及协议实现的改动另须与 [主机集成清单](host-integration-checklist.md)（渡口
维护的 Phase 3 章节）逐条对照。
