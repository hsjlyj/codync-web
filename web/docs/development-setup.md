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
| `npm run dev` | 启动站点（http://localhost:3000，根路径重定向到 `/client`） | 未复跑；构建见下行 |
| `npm run build` | 静态导出构建 | **已验证**（2026-11-04 营销站下线后榫卯实测：**13 个静态页**，`/` 重定向 + 9 个 /client 路由 + 404） |
| `npm run lint` | ESLint | 希音报 0 错 0 警（`29743ed`），本环境未复跑 |
| `npm run format:check` | Prettier 检查 | 未验证 |
| `npm test` / `npm run test:watch` | Vitest 单测 | **已验证**（2026-11-04 榫卯复跑于 `17de461`：**95/95**，16 个文件，含 7 项官方向量逐字节回归 + 2 项 mock-WebSocket 握手集成） |
| `npm run test:e2e` | Playwright E2E | 待试金补充用例 |
| `npx --no-install tsc --noEmit`（在 `packages/shared/`） | 共享包类型检查 | **已验证**（2026-11-03 新树复跑，exit 0） |

## 4. 目录速览

```
web/
├── app/                        # Next.js App Router（仅 Web 客户端）
│   ├── page.tsx                # `/`：meta refresh 重定向到 /client
│   └── client/                 # /client 连接页 · /client/chat 工作区
│                               # · /client/bots 管理台（含 new、edit?bot=<id>）
│                               # · /client/search · /client/settings
│                               # · /client/terminal?backend=&step= · /client/screen
├── src/client/                 # Web 客户端实现（测试与源码同目录 *.test.ts）
│   ├── transport/              # host-transport / channel-crypto（含向量副本）
│   │                           # / channel-transport / mock-transport（+mock-remote/mock-dirs）
│   │                           # / bytes / device-key / pairing-url
│   ├── store/                  # app-model · bot-admin · usage · library · search
│   │                           # · terminal（term 流控制器）· screen-view（WebRTC 会话）
│   ├── components/ · views/    # connect / roster（含分组拖拽）/ bots / thread 视图
│   │                           # （含 speech-input 听写）
│   └── use-app-model.ts        # useSyncExternalStore 接 React
├── packages/shared/            # @codync/shared：实体类型 + API 契约 + /channel 线类型
├── docs/                       # 本文档目录
├── test/                       # 测试基建（试金）
└── vitest.config.ts            # 单测配置（全局 testTimeout 15s，17de461）
```

> 营销官网（docs/download/compare 等路由、`content/` MDX 手册、
> `scripts/check-docs.mjs`）已于 2026-11-04 整体移除（`ce3c6d5`），
> 站点现在只包含 Web 客户端。

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

- ~~偶发测试失败~~ **已修复**（`17de461`）：`bytes.test.ts` 的 chunk 边界
  roundtrip 用例本体 <100ms，但 16 个 jsdom 文件并行时环境启动开销抖动，
  会间歇撞上 5s 默认超时（2026-11-04 三次复现，榫卯/试金各中一次）。
  修法：`vitest.config.ts` 全局 `testTimeout: 15s` + 用例注释记录 flake 历史；
  连续三次全量 95/95 全绿。
- **静态导出约束**：动态路由段（`[id]`）在 `output: export` 下不可用，
  参数走查询串（如 `/client/bots/edit?bot=<id>`、
  `/client/terminal?backend=<id>&step=…`）；文档与链接勿写 `[id]` 路径。
- **废弃树**：`/tmp/Codync-2.38.0/`、`/workspace/Codync-2.38.0/`、`/workspace/web/`
  已废弃（ADR-001 工作区约定），其中残留的 `relay/`/`bridge/` 代码勿参考。
- **共享树纪律**：动别人有未提交改动的文件前先在群里说明；提交只 stage
  自己的 hunk。
