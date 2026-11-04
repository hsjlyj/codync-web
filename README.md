# Codync Web 客户端

浏览器版 Codync 客户端：不装 App，打开网页即可远程指挥你电脑上的 coding agent（Claude Code、Codex、Gemini CLI 等）。

浏览器通过 WebSocket 直连你电脑上的 `codync-host`（`/channel` 端到端加密：X25519 密钥交换 + Ed25519 签名 + ChaCha20-Poly1305 加密帧），**无中间服务器**，权限完全由主机控制。

```
浏览器（本客户端）  ←─ E2E 加密 /channel ──→  codync-host（默认端口 19222）
```

Web 客户端代码在 `web/` 目录（Next.js 16 静态导出）；仓库其余部分是完整 Codync 2.38.0 源码（`host/` 服务端、`apps/` 各端官方客户端），部署 Web 客户端只需要 `web/`。

---

## 1. 前置要求

| 项目 | 要求 | 备注 |
|------|------|------|
| Node.js | ≥ 20 | 本环境实测 v24.22.2；更低版本未测试 |
| npm | 随 Node 自带 | `web/` 使用 npm（有 `package-lock.json`） |
| codync-host | v2.38.0 | 从 v2.38.0 起配对白名单包含 `web` 平台；主机默认端口 19222 |

只部署静态页面不需要 Rust 工具链；如需自行编译主机，见仓库根目录 `AGENTS.md`。

## 2. 获取代码

```bash
git clone https://github.com/hsjlyj/codync-web.git
cd codync-web
git checkout feat/web-client     # Web 客户端开发分支
cd web
npm install
```

## 3. 本地开发

```bash
cd web
npm run dev        # 启动后访问 http://localhost:3000/client
```

常用命令（均在 `web/` 下执行）：

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发服务器（http://localhost:3000） |
| `npm run build` | 生产构建：静态导出到 `web/out/` |
| `npm test` | Vitest 单元测试（当前 95/95，16 个文件） |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Playwright 冒烟测试（先执行 `npx playwright install chromium`） |

## 4. 部署

`next.config.ts` 已配置 `output: "export"`、`distDir: "out"`，构建产物是**纯静态文件**，不需要 Node 服务端：

```bash
cd web
npm run build      # 生成 web/out/
```

### 方式 A：任意静态托管（推荐）

把 `web/out/` 目录整体上传到任一静态托管服务即可，客户端入口为 `/client`：

- **GitHub Pages**：开启 Pages，部署来源选 `out/` 目录（或把 `out/` 内容推到 `gh-pages` 分支）
- **Cloudflare Pages / Netlify / nginx / Caddy**：站点根目录指向 `out/` 即可

示例（nginx）：

```nginx
server {
    listen 443 ssl;
    server_name codync.example.com;
    root /var/www/codync-web/out;     # 指向 out/ 目录
    index index.html;
}
```

### 方式 B：Vercel

新建 Vercel 项目，**Root Directory 设置为 `web/`**。仓库内 `web/vercel.json` 已限制只有 `main` 和 `dev` 分支触发自动部署，其他分支（含外部 PR）不产生预览。

### 方式 C：Cloudflare（Workers 静态资源，已实测）

前置：安装官方 `cf` CLI（`npm i -g @cloudflare/cli`），执行 `cf login` 完成 OAuth 登录（凭据存于 `~/.config/cloudflare/`，无需 API Token）。

新建一个独立部署目录（不要污染 `web/` 源码），把构建产物拷进去：

```bash
mkdir -p /workspace/deploy-codync-web && cd /workspace/deploy-codync-web
cp -r /workspace/codync-web/web/out ./out
```

写两个配置文件（`package.json` 只需 `"type": "module"`，并装 `cf` 与 `wrangler` 包以加载配置类型）：

`cloudflare.config.ts`：

```ts
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "codync-web",
    compatibilityDate: "2026-11-01",
    observability: { enabled: true }
  }
});
```

`wrangler.config.ts`：

```ts
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  "assetsDirectory": "out"
});
```

部署：

```bash
cd /workspace/deploy-codync-web
cf deploy          # 生成 <worker名>.<子域>.workers.dev，如 codync-web.xxx.workers.dev
```

- 更新：重新 `npm run build` 后覆盖 `out/`，再 `cf deploy` 即可，秒级生效
- 回滚/下线：`cf rollback` 或 `cf delete codync-web`
- 注意：`workers.dev` 域名在国内可能无法访问，可在 Cloudflare 后台为该 Worker 绑定自定义域名

> 新版 `cf` CLI 不再支持 legacy Pages 部署（`cf pages deploy` 被拒），静态站点统一走 Workers Assets 方式。

### 部署后访问

浏览器打开 `https://<你的域名>/client`。

## 5. 连接主机（配对）

1. 确保目标电脑上 `codync-host` v2.38.0 正在运行（默认端口 19222，局域网可达或经 Tailscale 等可达）
2. 打开 Web 客户端 `/client` 连接页
3. 两种方式之一：
   - **扫码/配对链接**：在主机上生成配对二维码或链接，浏览器扫描完成配对（两段式：`pair` → 主机确认 → 断开重连）
   - **手动直连**：填写主机地址；若未填写主机签名密钥（sk），连接页会显示安全警示——此时通道不做主机身份校验，局域网内使用注意甄别
4. 配对成功后设备密钥持久化在浏览器本地（WebCrypto，不可导出），之后重连自动恢复会话

## 6. 客户端功能路由

| 路由 | 功能 |
|------|------|
| `/client` | 连接 / 配对页 |
| `/client/chat` | 聊天工作区（Markdown、权限卡片、附件） |
| `/client/bots` | Bot 管理台（新建 `/client/bots/new`，编辑 `/client/bots/edit?bot=<id>`，分组拖拽排序） |
| `/client/search` | 本地搜索 |
| `/client/settings` | 设置（断开连接等） |
| `/client/terminal?backend=<id>&step=…` | 终端模拟器（xterm.js） |
| `/client/screen` | 屏幕共享查看（WebRTC） |

## 7. 验证部署

```bash
cd web
npm test           # 单元测试，预期 95/95 通过
```

端到端联调需要真实主机：本机有 Rust 工具链时编译 `host/`（`cargo run -- serve`），再在 `/client` 完成真实配对。Playwright 冒烟（`npm run test:e2e`）需要可启动浏览器的环境，无头沙箱中无法真跑。

## 8. 文档

详细文档在 `web/docs/`：

- [架构说明](web/docs/architecture.md) — 分层与数据流
- [ADR-001：/channel E2E 直连](web/docs/adr/001-channel-e2e.md) — 架构决策记录
- [开发环境搭建](web/docs/development-setup.md) — 完整开发命令与目录速览
- [API 参考](web/docs/api-reference.md) — 主机方法与权限边界（逐方法经源码核对）
- [使用指南](web/docs/user-guide.md) · [首次连接教程](web/docs/first-connection.md) · [FAQ](web/docs/faq.md)
- [代码审查清单](web/docs/review-checklist.md) — 审查口径与历史结论
