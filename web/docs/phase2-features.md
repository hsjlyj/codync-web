# Phase 2 功能清单与验收标准

> 更新：2026-11-04 · 维护：榫卯 · 分支：`feat/web-client`
> 用户故事视角见 [phase2-user-stories.md](phase2-user-stories.md)（风落，6 个故事）；
> 本文件是功能与验收的**实现视角**，两者互补、以主机源码事实为准。

## 0. 事实基线（先读，避免按不存在的方法验收）

以下经源码核实（希音/砚台，2026-11-04；与 [API 参考 §4.2](api-reference.md) 一致）：

- 主机**没有** `setBotPosition` / `setBotSection` 方法——用户故事 4 中这两个
  调用名作废，实际方法见下表。
- 主机**没有**消息级 `search` 方法（仅 marketplace 搜索）——Phase 2 搜索面板
  只做**本地过滤**；跨全量历史搜索需主机新增 API，**未决**（渡口/若光评估中），
  验收标准不含它。

## 1. 功能状态与主机方法

| 功能 | 状态 | 主机调用 |
|------|------|----------|
| 新建 Bot | Phase 2 规划 | `createBot`（`BotDraft` → `{bot}`） |
| 编辑 Bot | Phase 2 规划 | `updateBot`（`BotDraft` → `{bot}`） |
| 删除 Bot | Phase 2 规划 | `deleteBot`（`{botId}`） |
| 排序与分组 | Phase 2 规划 | `reorderBots({ids})` 整体顺序 · `updateBot` 的 `section` 字段移动分组 · `renameSection({from, to?})` 改名/清空 |
| 设置面板 | Phase 2 规划 | `hello`（主机信息 name/version/os）+ 本地偏好 |
| 搜索（本地过滤） | Phase 2 规划 | 无主机调用（过滤已加载消息） |
| Artifact 查看 / Marketplace / 用量统计 | Phase 2 规划（后置） | `library` / `readArtifact` / `usage` 等 |

## 2. 验收标准（Given / When / Then）

### F1 新建 Bot（故事 1）

- **Given** 已连接主机，且至少一个 agent backend 可用
- **When** 打开新建表单，name 为空提交
- **Then** 提交被阻止，显示必填提示，未发出 `createBot`
- **When** 正确填写并提交
- **Then** 发出 `createBot`（BotDraft），事件流回推后 Bot 出现在 BotRoster；
  表单恢复默认值

### F2 编辑 Bot（故事 2）

- **Given** 列表中已存在目标 Bot
- **When** 打开编辑表单并保存修改
- **Then** 发出 `updateBot`（**`id` 必填**，hub.rs:251），列表按事件流更新显示新值；
  取消则不产生任何变更
- 字段校验：name 非空；model 取值限于 `agentModels` 返回范围

### F3 删除 Bot（故事 3）

- **Given** 列表中已存在目标 Bot
- **When** 菜单选择删除并在确认框确认
- **Then** 发出 `deleteBot`，Bot 从列表消失；失败时 Bot 保留并显示错误提示

### F4 排序与分组（故事 4，方法名以 §0 为准）

- **Given** 列表中已有 ≥2 个 Bot
- **When** 拖拽调整顺序并结束
- **Then** 发出 `reorderBots({ids})`，刷新/重连后顺序保持（以主机为准）
- **When** 拖拽到其他分组
- **Then** 经 `updateBot` 更新 `BotDraft.section`，分组变化经事件流同步
- **When** 重命名或清空分组
- **Then** 发出 `renameSection({from, to})`；`to` 为空/null 表示移除分组

### F5 设置面板（故事 5）

- **Given** 已连接主机
- **When** 打开设置页
- **Then** 显示主机信息（来源 `hello`：name / version / os）与设备信息
- **When** 点击断开连接
- **Then** 清除本地设备身份，返回连接页；主机侧设备可在桌面端撤销
- **When** 切换主题 / 调整文字大小
- **Then** 偏好本地持久化，立即生效，无需重新配对

### F6 搜索（故事 6，仅本地过滤）

- **Given** 当前会话已加载聊天消息
- **When** 按 Cmd/Ctrl+K 唤起搜索并输入关键词
- **Then** 对**已加载**消息实时过滤（大小写不敏感），命中高亮；
  清空关键词恢复完整列表
- 跨全量历史搜索：依赖主机新增 API，**未决**；未决前不纳入验收

## 3. 统一验收标准

沿用 [用户故事文档的统一表](phase2-user-stories.md)（INVEST、<500 行、
kebab-case、vitest ≥80%、tsc 0 错、`next build` 通过、Conventional Commits），
另加两条文档侧要求：

- 功能合入同一次改动更新本文件状态列与 [user-guide](user-guide.md) 对应章节
- 涉及主机方法使用的变更，与 [API 参考](api-reference.md) 对照核对参数

## 4. 开放决策

| 议题 | 负责人 | 状态 |
|------|--------|------|
| 主机是否新增跨历史消息 `search` API | 渡口 / 若光 | Phase 2 确定本地过滤（渡口已核实主机无此方法）；是否新增 API 未决 |
| 断开连接是否同时调 `forgetDevice` 撤销主机侧设备 | 砚边（安全口径） | 未确认；当前实现仅清本地 |

> 方法载荷细节以 [主机集成清单](host-integration-checklist.md)（渡口）与
> [API 参考](api-reference.md)（砚台，`06c8e3c` 含 Artifact/LibraryItem 建模）为准。
