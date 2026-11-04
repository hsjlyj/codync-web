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

## 3. 常用命令（`web/` 下）| 命令 | 作用 | 状态 |
|------|------|------|
| `npm run dev` | 启动站点（http://localhost:3000，客户端在 `/client`） | 未复跑；`next build` 已验证通过（希音，`29743ed`，4 个 client 路由入产物） |
| `npm run build` | 静态导出构建 | 已验证（希音，`29743ed`） |
| `npm run lint` | ESLint | 希音报 0 错 0 警（`29743ed`），本环境未复跑 |
| `npm run format:check` | Prettier 检查 | 未验证 |
| `npm run check:docs` | 站点文档检查（`scripts/check-docs.mjs`） | 未验证 |
| `npm test` / `npm run test:watch` | Vitest 单测 | **已验证**（2026-11-04 榫卯复跑于 `d9f34df`：**73/73**，12 个文件，含 7 项官方向量逐字节回归） |
| `npm run test:e2e` | Playwright E2E | 待试金补充用例 |
| `npx --no-install tsc --noEmit`（在 `packages/shared/`） | 共享包类型检查 | **已验证**（2026-11-03 新树复跑，exit 0） |

## 4. 目录速览

```
web/
├── app/                        # Next.js App Router（官网 + 客户端）
│   └── client/                 # /client 连接页 · /client/chat 工作区
│                               # · /client/bots 管理台（含 new、edit?bot=<id>）
│                               # · /client/search · /client/settings
├── src/client/                 # Web 客户端实现（测试与源码同目录 *.test.ts）
│   ├── transport/              # host-transport / channel-crypto（含向量副本）
│   │                           # / channel-transport / mock-transport
│   │                           # / bytes / device-key / pairing-url
│   ├── store/                  # app-model · bot-admin · usage · library · search
│   ├── components/ · views/    # connect / roster（含分组拖拽）/ bots / thread 视图
│   └── use-app-model.ts        # useSyncExternalStore 接 React
├── packages/shared/            # @codync/shared：实体类型 + API 契约 + /channel 线类型
├── docs/                       # 本文档目录
├── test/                       # 测试基建（试金）
├── vitest.config.ts            # 单测配置
├── content/                    # 上游用户手册（Mdx）
└── scripts/                    # 站点脚本（含 check-docs.mjs）
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

- **偶发测试失败**：全量 vitest 偶发 1 例失败、重跑即绿（2026-11-04 两次观察：
  一次为较重的 `bytes` chunk 边界用例 ~4.5s，另一次失败用例未捕获；两次复跑
  均全绿 73/73）。试金跟进 `testTimeout`/CI 稳定性策略；复现请整跑 `npm test`。
- **静态导出约束**：动态路由段（`[id]`）在 `output: export` 下不可用，
  参数走查询串（如 `/client/bots/edit?bot=<id>`）；文档与链接勿写 `[id]` 路径。
- **废弃树**：`/tmp/Codync-2.38.0/`、`/workspace/Codync-2.38.0/`、`/workspace/web/`
  已废弃（ADR-001 工作区约定），其中残留的 `relay/`/`bridge/` 代码勿参考。
- **共享树纪律**：动别人有未提交改动的文件前先在群里说明；提交只 stage
  自己的 hunk。
