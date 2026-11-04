# Phase 3 功能清单与验收标准

> 更新：2026-11-04 · 维护：榫卯 · 分支：`feat/web-client` · 状态：**实现中**
> 真实主机联调未完成，本文档全部功能**尚未验证**；验收口径以实现落地后实测为准。
> 协议事实由希音/砚台 2026-11-04 源码核实，榫卯复核了标注的三处。

## 0. 事实基线（先读）

- **订阅机制**：`{"id","sub":"term","b":{"term":id}}` 开订阅；事件以 `{"id","ev"}`
  帧下发；结束 `{"id","end":true}`（channel.rs:877 处可见订阅格式）
- **term 事件内容**：`{"type":"output","data":<base64>}` 输出；
  `{"type":"exit","code":n}` 结束（exit 后流终止）
- **屏幕信令**：`screenPrepare` → `{session, iceServers, expiresAt, trickle}`
- **顺序约束（易错点）**：必须**先开 `screenCandidates` 订阅再发 `screenOffer`**
  （`host/src/screen/signaling.rs:134` 原文 "open screenCandidates before
  offering"，榫卯复核）；trickle 协商失败时走完整 SDP 回退，不开订阅
- **candidate 结构**（tagged enum）：`{"type":"candidate","candidate",
  "sdpMLineIndex","sdpMid"}` 或 `{"type":"complete"}`
- **语音权限**：`voiceStatus` / `voiceSession` / `voiceModels` / `voiceTranscribe` /
  `voiceSpeak` 设备可调；`setVoiceKey` 本机专属（[API 参考 §4.1](api-reference.md)）
- **网络管理受限**：`network*` 方法除 `networkView` 外全部本机专属
  （`host/src/api/network.rs:2`）——Web 端只能**只读查看**，管理操作回桌面端/主机

## 1. 功能状态

| 功能 | 状态 | 依据方法/能力 |
|------|------|--------------|
| 终端模拟器 | 实现中 | `agentSetup`（install/login）→ term 订阅 → `termInput` / `termResize` / `termClose` |
| 语音输入 | 实现中 | 浏览器 Web Speech API；主机转写走 `voiceSession` / `voiceTranscribe` |
| 屏幕查看 | 实现中 | `screenPrepare` / `screenOffer` + `screenCandidates` 订阅（WebRTC） |
| 网络查看（只读） | 规划 | `networkView`（其余 `network*` 本机专属，设备不可调） |

## 2. 验收标准（Given / When / Then）

### F1 终端模拟器

- **Given** 已连接主机，存在待安装/待登录的 agent backend
- **When** 发起 `agentSetup` 并订阅 term 流
- **Then** 终端输出按 base64 解码实时渲染（xterm.js）；键入经 `termInput`
  下发生效；尺寸变化经 `termResize`；流以 `exit` 事件收尾且订阅正确关闭
- 交互细节（复制粘贴、字体缩放）与桌面端对齐

### F2 语音输入

- **Given** 浏览器支持 Web Speech API（或选择主机转写路径）
- **When** 按住/点击语音输入并说话
- **Then** 中间结果（interim）实时上屏、最终结果（final）进入 Composer 可编辑；
  主机转写路径的凭据由 `voiceSession` 按次签发
- 不可在 Web 端配置 API key（`setVoiceKey` 本机专属）——配置入口在桌面端，
  界面需说明这一点

### F3 屏幕查看

- **Given** 主机已开启屏幕能力
- **When** 打开屏幕查看
- **Then** 按事实基线的顺序完成信令（**先订阅 `screenCandidates`，再
  `screenPrepare`/`screenOffer`**），WebRTC 建流后画面渲染；candidate 按
  tagged 结构收发；trickle 失败自动降级完整 SDP；关闭时清理订阅与会话
- 输入控制：手机端可控制本机，Web 端是否开放输入**未确认**——先按只读
  查看器验收

### F4 网络查看（只读）

- **Given** 主机加入了多机网络
- **When** 打开网络页
- **Then** 展示 `networkView` 返回的对端与状态（只读）；不出现任何管理操作
  入口（创建/加入/邀请等均本机专属）

## 3. 已知限制

- **真实主机联调未完成**：上述全部功能未验证，Phase 3 不宣称可用
- **语音**：Web Speech API 以 Chrome 系支持最好；API key 配置本机专属
- **屏幕**：Web 端定位为查看器；是否开放输入控制未确认
- **终端**：`exit` 后流终止，重连需重新 `agentSetup`

## 4. 统一验收标准

沿用 [Phase 2 统一标准](phase2-features.md)（INVEST、<500 行、kebab-case、
vitest ≥80%、tsc 0 错、`next build` 通过、Conventional Commits、文档同改）；
涉及协议实现的改动另须与 [主机集成清单](host-integration-checklist.md)（渡口
维护的 Phase 3 章节）逐条对照。
