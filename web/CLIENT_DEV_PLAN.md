# Codync Web 化 — 详细开发计划

## 项目概览
- **目标**: 将 Codync v2.38.0 桌面客户端完整复刻为 Web 版本
- **方案**: 方案一 — 远程主机 + Web 客户端
- **技术栈**: Next.js 16 + React 19 + Tailwind CSS + TypeScript
- **代码仓库**: `hsjlyj/Codync` → `web/` 目录新增 `client/` 子目录

## 团队分工与里程碑

### Phase 0：脚手架与环境（Week 1）
| 任务 | 负责人 | 交付物 |
|------|--------|--------|
| Web 客户端项目初始化（Next.js + Tailwind） | 希音 | `web/app/client/` 可运行脚手架 |
| Relay 代理服务器搭建（Node.js/Express） | 渡口 | `relay/` 目录，可转发 WebSocket |
| 共享类型定义提取（models.ts → shared package） | 砚台 | `@codync/shared` 类型包 |
| 主机 API 权限模型分析 & CORS 策略 | 砚边 | 安全评估报告 |
| 远程连接方案技术验证（PoC） | 左丞 | 可行的 WebSocket 桥接 PoC |
| 架构设计评审 | 岚序 + 新刃 | 评审通过记录 |

### Phase 1：核心聊天 MVP（Week 2-3）
| 任务 | 负责人 | 交付物 |
|------|--------|--------|
| 远程客户端连接层（RemoteClient） | 希音 | 替代 host-client.ts，支持远程 WebSocket |
| AppModel 适配远程模式 | 希音 | store/app-model.ts 的远程版本 |
| Bot 列表 + 聊天窗口 | 希音 | ChatWindow + BotRoster 组件 |
| 消息发送/接收 + 历史加载 | 希音 | ThreadView + bot-exchange 逻辑 |
| 认证流程（配对码/Token 输入） | 渡口 + 希音 | 登录页面 + 认证状态管理 |
| 文件上传（图片/文档） | 希音 | ComposerAttachment + upload API |
| 主机连接状态管理 | 希音 | HostStateView 适配远程 |

### Phase 2：完整功能（Week 4-5）
| 任务 | 负责人 | 交付物 |
|------|--------|--------|
| Bot CRUD（创建/编辑/删除/分组） | 希音 | BotEditor + NewBotView |
| 设置面板（账户、网络偏好） | 希音 | SettingsView |
| 用量统计面板 | 希音 | UsageBar + ProviderMascot |
| 代码片段/Artifact 查看器 | 希音 | ArtifactView + LibraryView |
| 搜索面板 | 希音 | SearchPalette |
| Marketplace 插件浏览 | 希音 | MarketplaceView |
| 通知系统（浏览器通知） | 希音 | 替代系统托盘 |

### Phase 3：高级功能（Week 6-8）
| 任务 | 负责人 | 交付物 |
|------|--------|--------|
| 终端模拟器（xterm.js + WebSocket） | 希音 | TerminalView 组件 |
| 语音输入（Web Speech API） | 希音 | DictationEngine 适配 |
| 多计算机网络管理 | 希音 | NetworkView + ComputerRoster |
| 屏幕共享查看器 | 希音 | ScreenShare 组件 |
| 自动化例程管理 | 希音 | RoutinesView |
| 离线缓存/Service Worker | 希音 | PWA 支持 |
| 性能优化（虚拟列表、懒加载） | 希音 | 滚动性能优化 |

### 全程任务
| 任务 | 负责人 | 说明 |
|------|--------|------|
| 单元测试编写 | 试金 | 关键模块测试覆盖 |
| E2E 测试 | 试金 | Playwright 测试 |
| 代码审查 | 新刃 | 每个 PR 审查 |
| API 文档 | 榫卯 | 开发者文档 |
| 用户文档 | 榫卯 | 使用指南 |
| 构建/部署流水线 | 浮生 | CI/CD 配置 |
| 数据模型映射 | 砚台 | 前后端类型对齐 |
| 产品需求细化 | 风落 | 用户故事 + 验收标准 |
| 安全审计 | 砚边 | 认证/授权审查 |

## 关键技术决策

### 1. Relay 代理架构
```
浏览器 WebSocket → Relay Server (Node.js) → codync-host (Rust)
                  ↑                              ↑
             CORS + JWT                    Bearer Token
             连接复用                        loopback
```

Relay 服务器职责：
- 将浏览器 WebSocket 连接桥接到主机本地 HTTP/SSE
- 处理认证握手（配对码验证）
- 添加 CORS 头
- 消息转发与协议适配

### 2. 认证方案
- **初次连接**: 用户在 Web 界面输入配对码 → Relay 向主机 `POST /api/pairing` → 返回配对 URL
- **设备绑定**: 成功后颁发设备 Token（通过 `devices` API 注册）
- **后续连接**: 使用设备 Token 建立 WebSocket 连接

### 3. 共享代码复用
- `@codync/shared` 包包含：models.ts, network.ts, calls.ts, artifacts.ts
- 桌面端和 Web 端共用类型定义
- 减少重复代码，确保数据一致性

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 主机 API 不支持远程调用 | 高 | Relay 代理解决 |
| WebSocket 连接不稳定 | 中 | 自动重连 + 离线队列 |
| 浏览器安全限制（剪贴板/文件） | 低 | Progressive Enhancement |
| 性能问题（大量消息） | 中 | 虚拟列表 + 分页加载 |
| 语音 API 浏览器兼容性 | 中 | 降级为手动输入 |
