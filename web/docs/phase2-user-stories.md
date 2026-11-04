# Phase 2 — User Stories & Acceptance Criteria

**Branch**: `feat/web-client`  
**Purpose**: Define usable, testable stories for Bot CRUD, 设置, and 搜索 functionality in the Web client.

---

## 📋 新建 Bot

**User Story**:  
> 作为用户，我想通过填写表单创建一个新的 Bot，并在 Bot 列表中看到它。

**Acceptance Criteria**:
- [ ] 访问 `/client/bots/new` 路由打开新建 Bot 表单
- [ ] 表单包含字段：name (必填), description, avatarColor, avatarShape, backend (下拉选择), cwd, permission (ask/auto), model, mode
- [ ] name 为必填项，输入为空时提交被阻止并显示错误提示
- [ ] 提交表单调用 `createBot` channel 方法
- [ ] 成功后跳转到聊天页面 `/client/chat` 并显示新创建的 Bot
- [ ] 新创建的 Bot 出现在 Bot 列表（`BotRoster`）中，状态显示为在线/离线
- [ ] 表单重置后字段恢复为默认值
- [ ] 辅助文字符合 kebab-case 命名 convention

**Definition of Done**:
- 组件位于 `views/bots/NewBotForm.tsx`，< 500 行
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对表单验证的单元测试通过
- `next build` 成功，/client 路由全部入产物
- Commit 涉及范围: `web`

---

## 📋 编辑 Bot

**User Story**:  
> 作为用户，我想修改现有 Bot 的配置并保存更改。

**Acceptance Criteria**:
- [ ] 访问 `/client/bots/[id]/edit` 路由打开编辑表单，预填当前 Bot 的所有字段
- [ ] 所有字段可编辑，修改后保存调用 `updateBot` channel 方法
- [ ] 保存成功后表单关闭，Bot 列表中的对应条目更新显示新值
- [ ] 取消编辑可放弃修改，返回 Bot 列表而不保存
- [ ] 字段级别验证：name 非空、model 在有效选项范围内
- [ ] 编辑后的 Bot 在列表中按最新状态重新排序（如果应用了分组）

**Definition of Done**:
- 组件位于 `views/bots/[id]/EditBotForm.tsx`，< 500 行
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对编辑逻辑的单元测试通过
- `next build` 成功
- Commit 涉及范围: `web`

---

## 📋 删除 Bot

**User Story**:  
> 作为用户，我想删除不再需要的 Bot，确认后从列表中消失。

**Acceptance Criteria**:
- [ ] 在 Bot 列表中右键点击 Bot 或点击更多菜单 → "删除"
- [ ] 显示确认对话框："确定要删除 \"<Bot名称>\" 吗？此操作不可撤销。"
- [ ] 点击 "确认" 后调用 `deleteBot` channel 方法
- [ ] 删除成功后 Bot 从列表中消失，不再出现在 BotRoster 中
- [ ] 删除失败（如后端报错）显示错误提示，Bot 仍保留在列表中
- [ ] 删除操作有 Undo 提示（可选），在 2 秒后自动消失

**Definition of Done**:
- 组件集成在 `views/bots/BotRoster.tsx` 的菜单项中
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对删除流程的单元测试通过
- `next build` 成功
- Commit 涉及范围: `web`

---

## 📋 Bot 分组管理

**User Story**:  
> 作为用户，我想将 Bot 拖拽到不同的分组（如 Work/Personal）并重新排序。

**Acceptance Criteria**:
- [ ] BotRoster 侧边栏显示分区：Work 和 Personal（可配置）
- [ ] Bot 可以通过拖拽移动到不同分区
- [ ] 拖拽结束后调用 `reorderBots({ids})` 进行排序
- [ ] 分区变更通过 `updateBot` 的 `section` 字段持久化
- [ ] Bot 在新分区中按拖拽顺序排列
- [ ] 分区改名通过 `renameSection({from,to})` 进行
- [ ] 刷新页面后分区布局保持不变（或从服务器同步）

**Definition of Done**:
- 组件位于 `views/bots/BotRoster.tsx` 中的拖拽逻辑
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对拖拽交互的测试通过
- `next build` 成功
- Commit 涉及范围: `web`

---

## 📋 设置面板

**User Story**:  
> 作为用户，我想在设置面板中查看账户信息、断开连接，并调整外观偏好。

**Acceptance Criteria**:
- [ ] 访问 `/client/settings` 打开设置面板
- [ ] 面板显示当前设备名、平台标识、首次配对时间
- [ ] "断开连接" 按钮清除本地设备密钥，返回登录页
- [ ] "主机信息" 区域显示 hello API 返回的 name/version/os
- [ ] "主题切换" 可在明亮/暗色之间切换，偏好持久化
- [ ] "文字大小" 调整滑块/输入框，实时调整文本显示比例
- [ ] 所有修改均无需重新登录即可生效

**Definition of Done**:
- 组件位于 `views/settings/SettingsView.tsx`，< 500 行
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对设置面板的单元测试通过
- `next build` 成功
- Commit 涉及范围: `web`

---

## 📋 搜索面板

**User Story**:  
> 作为用户，我想输入关键词搜索跨 Bot 的消息或过滤已加载的消息。

**Acceptance Criteria**:
- [ ] 快捷键 Cmd+K（或 Ctrl+K）聚焦搜索面板
- [ ] 输入关键词后实时过滤聊天消息列表（客户端本地过滤）
- [ ] 搜索在当前加载的消息历史中模糊匹配
- [ ] 搜索结果突出显示匹配的关键词
- [ ] 可以清除搜索文本，恢复完整消息列表
- [ ] 搜索不区分大小写，支持模糊匹配
- [ ] **跨历史全量搜索**: 需要主机新增 API，Phase 2 暂不实现（见开放决策）

**Definition of Done**:
- 组件位于 `views/SearchPalette.tsx`，< 500 行
- 通过 `tsc --noEmit` 通过
- 通过 `vitest run` 针对搜索逻辑的测试通过
- `next build` 成功
- Commit 涉及范围: `web`

---

## 📌 统一验收标准（All Phase 2 Stories）

| 标准 | 要求 |
|------|------|
| **INVEST** | 每个故事都是 Independent, Negotiable, Valuable, Estimable, Small, Testable |
| **文件大小** | 单个组件/页面 < 500 行（TSX） |
| **代码规范** | kebab-case 命名、两格缩进、views 不持有 I/O（逻辑放在 app-model） |
| **测试** | 每个功能有对应的单元测试（vitest），通过率 ≥ 80% |
| **构建** | `tsc --noEmit` 0 错误、`next build` 成功 |
| **提交** | Conventional Commit，scope=web（如: `feat(web): add new bot form`） |
| **文档** | 用户故事文档已同步至 `web/docs/phase2-user-stories.md` |

---

**提交指南**:  
所有实现完成后，请提交 Conventional Commit 到 `feat/web-client` 分支，格式示例：
```
feat(web): add new bot form with validation and createBot integration
 chore(web): add phase2 user stories document
```

---