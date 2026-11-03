# 开发环境搭建

> 更新：2026-11-03 · 维护：榫卯 · 命令均标注验证状态
> 唯一工作树：`/workspace/codync-2.38.0/`（分支 `feat/web-client`）。

## 1. 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 20 | 环境实测 v24.22.2（更低版本未测，标注：未确认） |
| npm | 随 Node | `web/` 使用 npm（有 `package-lock.json`；近期新增 noble 依赖后 lock 是否同步**未确认**，安装用 `npm install` 更稳妥） |
| Rust 工具链 | stable | 仅当需要构建/调试 codync-host；本环境未验证，命令见仓库根 AGENTS.md |

## 2. 获取代码与依赖

```bash
git -C /workspace/codync-2.38.0 checkout feat/web-client   # 所有开发在此分支
cd web
npm install          # 新树尚未安装过依赖（2026-11-03 核实）
```

安装完成后建议复跑一次 `npx --no-install tsc --noEmit`（`web/packages/shared/`）
确认类型环境就绪。

## 3. 常用命令（`web/` 下）

| 命令 | 作用 | 状态 |
|------|------|------|
| `npm run dev` | 启动站点（http://localhost:3000） | 新树未验证；迁移前旧树实测能进入编译阶段，待复测 |
| `npm run build` | 静态导出构建 | 未验证 |
| `npm run lint` | ESLint | 未验证 |
| `npm run format:check` | Prettier 检查 | 未验证（`.prettierrc.json` 由希音新增） |
| `npm run check:docs` | 站点文档检查（`scripts/check-docs.mjs`） | 未验证 |
| `npm test` / `npm run test:watch` | Vitest 单测 | 用例由试金补充中 |
| `npm run test:e2e` | Playwright E2E | 框架搭建中，未验证 |
| `npx --no-install tsc --noEmit`（在 `packages/shared/`） | 共享包类型检查 | **已验证**（迁移前树，2026-11-03，exit 0） |

## 4. 目录速览

```
web/
├── app/                # Next.js App Router（站点 + 客户端页面）
├── src/client/         # Web 客户端实现（ChannelTransport、状态层；希音开发中）
├── packages/shared/    # @codync/shared：实体类型 + API 契约 + /channel 线类型
├── docs/               # 本文档目录
├── test/               # 测试（试金搭建中）
├── vitest.config.ts    # 单测配置
├── content/            # 上游用户手册（Mdx）
└── scripts/            # 站点脚本（含 check-docs.mjs）
```

关键源码参考（均在仓库内，v2.38.0）：

| 想了解 | 看这里 |
|--------|--------|
| `/channel` 握手与加密帧 | `host/src/remote/channel.rs`、`host/src/remote/crypto.rs` |
| 方法权限边界（LOCAL_ONLY） | `host/src/api/devices.rs` |
| API 全集 | `docs/api-reference.md`（本目录） |
| 测试向量 | `docs/reference/fixtures/remote-relay-vectors.json`（12 组） |
| 桌面端传输抽象 | `apps/desktop/src/shared/host-client.ts`（`HostTransport`） |

## 5. 实现加密时的两条硬规则

1. **不要在 `@codync/shared` 里引入运行时依赖**（含 `@noble/*`）——
   该包保持纯类型 + 纯函数；noble 系挂在 Web 客户端自己的 package.json（ADR-001）。
2. **帧编解码/握手实现必须过官方向量回归**
   `docs/reference/fixtures/remote-relay-vectors.json`，
   不要自己造 fixture（试金 2026-11-03 结论）。

## 6. 已知坑

- **废弃树**：`/tmp/Codync-2.38.0/`、`/workspace/Codync-2.38.0/`、`/workspace/web/`
  已废弃（ADR-001 工作区约定），其中残留的 `relay/`/`bridge/` 代码勿参考。
- **共享树纪律**：动别人有未提交改动的文件前先在群里说明；提交只 stage
  自己的 hunk。
