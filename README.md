# Codync Web

用浏览器远程指挥你电脑上的 coding agent（Claude Code、Codex、Gemini CLI 等）——不用装 App，打开网页就行。

浏览器通过 WebSocket **直连**你电脑上的 `codync-host`，走端到端加密的 `/channel` 通道（X25519 密钥交换 + Ed25519 主机签名 + ChaCha20-Poly1305 加密帧），**没有中间服务器**，权限完全由主机控制。

```
浏览器（web/）  ←── E2E 加密 /channel ──→  codync-host（默认端口 19222）
```

本仓库 = **主机端**（`host/`，Rust daemon）+ **Web 客户端**（`web/`，Next.js 静态站点）。两边都能独立部署，但要配对成功必须两边配套——见 [第四节](#四两端配对)。

- [本仓库的结构](#本仓库的结构)
- [与上游 Codync 的关系](#与上游-codync-的关系)
- [一、主机端部署](#一主机端部署)
- [二、已知限制与安全说明](#二已知限制与安全说明)
- [三、Web 端部署](#三web-端部署)
- [四、两端配对](#四两端配对)
- [五、验证与排错](#五验证与排错)
- [六、文档索引](#六文档索引)

---

## 本仓库的结构

```
.
├── host/                                   # 主机端：Rust daemon（codync-host）
├── web/                                    # Web 端：Next.js 16 静态导出客户端
├── apps/ios/Kit/Sources/CodyncKit/Resources/Languages/
│                                           #   9 个语言 json —— host 编译期 include_str! 依赖，勿删
├── docs/reference/fixtures/                #   加密测试向量（host + web 测试依赖）
├── packaging/updates/host-public-key.txt   #   更新验签公钥 —— host 编译期依赖，勿删
├── README.md
└── LICENSE / NOTICE / SECURITY.md / CODE_OF_CONDUCT.md / TRADEMARK.md
```

上面 `apps/`、`docs/reference/fixtures/`、`packaging/updates/` 三处是**主机端编译或测试的硬依赖**。它们看起来像别的模块的残留，但 `include_str!` 在编译期就会读它们，删掉 `cargo build` 直接失败。

其余与主机端、Web 客户端无关的内容（iOS / Android / 桌面 App 源码、`cloud/`、`relay/`、营销站等）已从本仓库移除。

## 与上游 Codync 的关系

本仓库基于 **Codync 2.38.0** 源码（`host/Cargo.toml:3` 的 `version = "2.38.0"`），上游项目：[leepokai/Codync](https://github.com/leepokai/Codync)。

相对上游，本仓库有三处改动：

| 改动 | 位置 | 提交 |
|------|------|------|
| 主机端支持**无云账号本地配对** | `host/src/remote/channel/pairing.rs` | `14f0916` |
| 配对白名单加入 `web` 平台 | `host/src/remote/channel/pairing.rs:35` | `f028e75` |
| **Web 客户端**（上游没有，本仓库自研） | `web/` | Phase 1–3 各提交 |

**本地配对补丁做了什么**（三处，其余逻辑与上游一致）：

1. `admit()` 改为返回 `Option<Certified>`：**设备证书缺失**时，只在本机「不在任何账号」的情况下接受；主机已在账号中仍以 `4400` 拒绝。
2. `let_in()` 收 `Option<&Certified>`，设备以 `account: None` 落库——本地配对**不会凭空给主机造出一个账号**。
3. 账号 claim 只对**云端签发证书**的设备发送。

这三处就是「不登录 Codync 云账号也能用 Web 客户端」的全部秘密：上游要求设备持云端签发的证书，本仓库允许主机在**无账号状态**下用本机审批放行设备。

---

## 一、主机端部署

### 1.1 前置要求

| 项目 | 要求 | 依据 |
|------|------|------|
| Rust 工具链 | 通道 **1.99.0**，含 `clippy`、`rustfmt` 组件 | `host/rust-toolchain.toml` |
| Rust 版本下限 | 1.91（iroh / `codync-network` 的要求） | `host/Cargo.toml:5` 注释 |
| 操作系统 | macOS / Linux / Windows | `host/src/service/unix.rs`、`service/windows.rs` |

请用 **rustup** 安装。`rust-toolchain.toml` 会被 rustup 自动识别并切到 1.99.0；如果 PATH 上有一个更靠前的、不归 rustup 管的 `rust`（例如 Homebrew 装的），这个 pin 会被忽略——这是上游文档专门记过的坑。

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup show          # 应显示 host/rust-toolchain.toml 的 1.99.0
```

### 1.2 编译

```bash
cd host
cargo build --release
```

产物是 `host/target/release/codync-host`（`host/Cargo.toml:7` 的 `default-run = "codync-host"`）。release profile 开了 `lto = "thin"`、`codegen-units = 1`、`strip = true`（`host/Cargo.toml:107-110`），首次编译偏慢属正常。

> **未在本环境验证**：本仓库当前的开发环境没有 Rust 工具链（`which cargo` 为空），上面这条命令**没有真跑过**。本章的端口、路径、参数默认值均逐条核对过源码，但「能编出来」这件事本身未经实测。仓库内 `.github/workflows/host-ci.yml` 会在 CI 上编译，那是当前唯一的自动验证途径。

### 1.3 运行

**前台运行**（调试用，关掉终端即停）：

```bash
cd host
cargo run --release -- serve

# 或直接跑编译产物
./target/release/codync-host serve
```

| 参数 | 默认值 | 依据 |
|------|--------|------|
| `--port` | **19222** | `host/src/environment.rs:27-32` |
| `--bind` | `0.0.0.0` | `host/src/main.rs:88` |

数据目录 `~/.codync`（Dev 环境为 `~/.codync-dev`，端口 19223）。

`--bind` 默认监听所有网卡，好让浏览器 / 手机经局域网或 Tailscale 连进来；只想本机访问就加 `--bind 127.0.0.1`。

**安装为后台服务**（长期运行，推荐）：

```bash
# 先编译，再用 release 产物执行 install
cd host && cargo build --release
./target/release/codync-host install

# 换端口
./target/release/codync-host install --port 19222
```

> **注意**：`install` 安装的是**当前正在执行的那个二进制**（`host/src/service/unix.rs:92`、`service/windows.rs:70` 都取 `current_exe()`）。所以务必先 `cargo build --release`，再执行 `target/release/` 下的产物；否则可能把 debug 构建装成常驻服务。

服务形态：macOS 用 launchd（label `com.pokai.codync.host`），Linux 用 systemd user unit（`codync-host.service`）（`host/src/environment.rs:113-114`）。Windows 的服务细节**未确认**。

停止 / 卸载：

```bash
./target/release/codync-host stop        # 停服务，保留配置和数据
./target/release/codync-host uninstall   # 停服务并移除
```

### 1.4 生成配对链接

主机**必须正在运行**（`codync-host pair` 会先向主机发一次本地请求，`host/src/pair_cli.rs:27`）：

```bash
codync-host pair            # 打印二维码 + 配对链接
codync-host pair --json     # 机器可读（pairingUrl / urls / shortCode 等字段）
```

输出的链接形如：

```
codync://pair?v=3&name=<主机名>&id=<computerId>&sk=<主机签名公钥>&bk=<主机加密公钥>&code=<一次性配对码>&urls=<可达地址,逗号分隔>
```

（构造逻辑 `host/src/service/mod.rs:247-263`；Dev 环境的 scheme 是 `codync-dev://`。）

**把这条完整链接复制给 Web 端粘贴**——见 [第四节](#四两端配对)。二维码是给手机 App 扫的，Web 端用不上。

配对码的约束（`host/src/api/devices.rs:174-175`、`:227-235`）：

- 有效期 **10 分钟**
- 同时最多 **5 个**在活
- 限流：单来源 **3 次/分钟**，全主机 **10 次/分钟**

### 1.5 主机命令速查

全部子命令来自 `host/src/main.rs:81-207`；`--port` 默认 19222，写在子命令之后。

| 命令 | 作用 |
|------|------|
| `codync-host serve [--port] [--bind]` | 前台运行主机 |
| `codync-host install [--port]` | 安装并启动后台服务 |
| `codync-host uninstall` | 停止并移除后台服务 |
| `codync-host stop` | 停止后台服务，保留数据 |
| `codync-host status` | 是否已安装、是否在运行 |
| `codync-host pair [--json]` | 打印一次性配对二维码 / 链接 |
| `codync-host access [list \| approve <id\|code> \| deny <id\|code>]` | 查看 / 批准 / 拒绝待放行设备 |
| `codync-host devices [list \| revoke <key>]` | 查看 / 撤销已授权设备 |
| `codync-host info [--json]` | 本机身份与本地 API 详情（SSH 场景用） |
| `codync-host tui` | 在终端里跟 bot 对话 |
| `codync-host update [--check \| --status \| --auto on\|off]` | 更新主机 / 查看更新状态 |
| `codync-host reset-token` | 轮换本机的本地 API token |

---

## 二、已知限制与安全说明

以下三条来自针对本地配对补丁（`14f0916`）的安全审查结论，如实写在这里。

### 1. 无证书配对的设备，权限与有证书设备等价

经本地配对进来的浏览器设备，落库时是 `scopes = [Control, Screen]`、`source = Local`（`host/src/remote/channel/pairing.rs:128-130`）。

因为是 `Local` 来源，它**不参与租约与云端复核**（`host/src/api/devices.rs:156-164`），也**不会出现在账号侧的设备管理里**，只能在本机撤销（`revokeDevice` 是 `LOCAL_ONLY`，`host/src/api/devices.rs:63`）。

概括：它拿到的是**完整控制权 + 屏幕接管权**，而且不会因租约到期而失效。浏览器设备经 XSS 失守的概率高于手机 App，请据此评估风险。

### 2. 安全边界：配对审批只在主机本机生效

这条是正面结论，可以放心：

- `pairingRequests` 与 `decidePairing` 都在 `LOCAL_ONLY` 名单里（`host/src/api/devices.rs:67-68`）
- `permit()` 对配对通道**一律拒绝**（`Caller::Pairing { .. } => false`，`host/src/api/devices.rs:107`）

**远程设备无法替主机批准配对**——审批必须发生在主机本人的桌面 App、终端 UI 或本机 CLI 上。

### 3. 已知边界（**尚未修复**）

主机**曾经入过账号**、但云被关闭或改用私有 relay 时，`owner()` 会返回 `None`（`host/src/remote/owner.rs:21-23`），此时无证书设备**仍可经主机本机批准配对进来**。

也就是说，「已登录账号的主机拒绝无证书设备」并非绝对不变量。收紧方案（`admit()` 改读落库的 `account_owner` 而非 `owner()`）**尚未实现**。

> 语义上的取舍：云关闭或改用私有 relay 时 `owner()` 返回 `None`、这类主机接受无证书配对，是**有意接受**的行为——它正是「离线直连」场景（仍需有效配对码 + 主机本机批准）。按上一条的收紧方案改，反而会拒掉用户自己的主机。

### 4. 本机设备会在「电脑退出账号」时被一并吊销

本机配对（无证书）写库时 `account` 为空，这与 2.36 之前「未记录账号的老设备」在清理逻辑里**不可区分**（`host/src/store/devices.rs:133-147`）——所以**电脑退出账号时，这些本机设备会被一起吊销**。

这是 fail-closed 的取舍（吊销得更多而不是更少），不是缺陷。实际影响：主机退出 Codync 账号后，之前配对好的 Web 端需要重新配对。

---

## 三、Web 端部署

### 3.1 前置要求

| 项目 | 要求 | 依据 |
|------|------|------|
| Node.js | **≥ 20.9.0** | `next@16.2.1` 的 `engines.node` |
| npm | 随 Node 自带 | `web/` 有 `package-lock.json` |

本环境实测 Node **v24.22.2** / npm **11.19.1**。

### 3.2 本地开发

```bash
cd web
npm install
npm run dev
```

打开 <http://localhost:3000/client>（站点根 `/` 会自动跳转到 `/client`）。

### 3.3 构建静态产物

```bash
cd web
npm run build      # 产物在 web/out/
```

`web/next.config.ts` 配置了 `output: "export"` + `distDir: "out"`，产出**纯静态文件**，不需要 Node 服务端。

**构建结果（在 `feat/web-client` 分支实测）**：静态导出 **13 页**——`/`（跳转页）+ `/_not-found` + 9 个 `/client` 路由。

### 3.4 托管方式

#### 方式 A：任意静态托管（最简单）

把 `web/out/` 整个目录交给任一静态托管服务即可，客户端入口是 `/client`：

- **nginx / Caddy**：站点根目录指向 `out/`
- **GitHub Pages**：部署来源选 `out/` 目录，或把 `out/` 内容推到 `gh-pages` 分支
- **Cloudflare Pages / Netlify**：站点根目录指向 `out/`

nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name codync.example.com;
    root /var/www/codync-web/out;     # 指向 out/ 目录
    index index.html;
}
```

#### 方式 B：Vercel

新建 Vercel 项目，**Root Directory 设为 `web/`**。仓库内 `web/vercel.json` 已限制只有 `main` 和 `dev` 分支触发自动部署。

#### 方式 C：Cloudflare Workers（静态资源，已实测）

前置：安装官方 `cf` CLI（`npm i -g @cloudflare/cli`），执行 `cf login` 完成 OAuth 登录（凭据存于 `~/.config/cloudflare/`，无需 API Token）。

新建一个独立部署目录（不要污染 `web/` 源码），把构建产物拷进去：

```bash
mkdir -p ~/deploy-codync-web && cd ~/deploy-codync-web
cp -r /path/to/codync-web/web/out ./out
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
cd ~/deploy-codync-web
cf deploy          # 生成 <worker名>.<子域>.workers.dev
```

- **更新**：重新 `npm run build` 后覆盖 `out/`，再 `cf deploy`
- **回滚 / 下线**：`cf rollback` 或 `cf delete codync-web`
- 注意：`workers.dev` 域名在国内可能无法访问，可在 Cloudflare 后台为该 Worker 绑定自定义域名

> 新版 `cf` CLI 不再支持 legacy Pages 部署（`cf pages deploy` 被拒），静态站点统一走 Workers Assets 方式。

### 3.5 部署前必须知道的一件事：HTTPS 页面连不上 `ws://` 主机

浏览器禁止 `https://` 页面发起 `ws://` 连接（WebSocket 混合内容）。而主机端**只提供明文 HTTP/WS**——源码中没有 TLS 监听。

由此：

- 客户端页面是 **HTTPS**（Cloudflare Workers、Vercel 等）→ **无法直连** `ws://<主机>:19222`，必须给主机前置一个 TLS 反向代理，再用 `wss://` 地址连接
- 客户端页面是 **HTTP**（局域网自建、或 `http://localhost`）→ 可以直连 `ws://<主机>:19222`

另外，`crypto.subtle` 只在安全上下文（HTTPS 或 localhost）可用。非安全上下文下客户端会自动回退到 noble 曲线库的软件实现（`web/src/client/transport/device-key.ts:125-134`），设备密钥的保护强度随之下降。

> **本条依据浏览器混合内容规则 + 源码判断，未在本环境实测**——正式选型前请用目标浏览器验证一次。

> 配对与主机放行的完整步骤见下一节；**特别注意 Web 端不显示 6 位核对码**，主机放行要用 `requestId`。

---

## 四、两端配对

### 4.1 三条硬条件

缺一条就连不上：

1. **主机不登录 Codync 云账号**。这是唯一的放行条件：无证书设备只在「主机无 owner」时才走本机审批（`host/src/remote/channel/pairing.rs:86`）。一旦主机登了账号，无证书仍然被 `4400` 拒绝。
2. **Web 端粘贴完整的 `codync://pair?...` 链接**，不要用 6 位短码——短码要靠 Codync 云解析，Web 端没有云端，解析不了。
3. **在 90 秒内在主机上放行**（`host/src/remote/pairing_requests.rs:17` 的 `ASK_FOR`）。

### 4.2 配对步骤

**第 1 步｜主机生成配对链接**（主机需在运行）：

```bash
codync-host pair
```

复制终端打印的整条 `codync://pair?...` 链接。

**第 2 步｜Web 端粘贴链接**：打开已部署站点的 `/client`，把链接粘进配对输入框提交。

**第 3 步｜主机放行（90 秒内）**：

```bash
codync-host access list
```

输出每行形如 `<requestId>  <设备名> (<平台>, <邮箱>)  code <6位码>`。拿到 **requestId** 后：

```bash
codync-host access approve <requestId>
```

或拒绝：

```bash
codync-host access deny <requestId>
```

> **⚠️ 不要填 6 位短码。** Web 客户端**不显示** 6 位核对码（客户端未实现 `pair_check_code` 的展示逻辑），所以主机端 `code` 那一列会显示 `(waiting for the device)`，你无从核对。直接复制 `requestId` 最稳。填 6 位码会失败。
>
> 6 位核对码是给手机 App 两边对照用的。桌面 App 的弹窗和终端 UI 里按 `y` 也都是等价的放行方式。

> **关于审批文案**：本机配对（无证书）**不会**把电脑加入任何账号。若审批界面写着「joins your account」这类描述，那是不准确的旧文案——**本仓库之外的桌面 App 弹窗仍是这个旧文案**（桌面端代码不在本仓库，无法修改）；本仓库 CLI / TUI 的文案在推送前修正。看到那句不必担心，授权内容始终是「让这台浏览器设备进来」，但请记住它的实际权限见 [第二节第 1 条](#1-无证书配对的设备权限与有证书设备等价)。

**第 4 步｜完成**：Web 端配对成功后，设备密钥存进浏览器（IndexedDB，WebCrypto 不可导出密钥优先），之后重连自动恢复会话，不用再放行。

### 4.3 错误码对照

连接被拒时 WebSocket 会带一个 close code（`host/src/api/devices.rs:131-138`）：

| close code | 含义 | 处理 |
|------------|------|------|
| `4400` | `UnsupportedVersion`：设备证书缺失，且主机已登入账号 | 主机必须处于**未登录云账号**状态 |
| `4001` | 未授权 / 租约过期 / 签名不符 | 重新配对 |
| `4003` | 该设备已被撤销 | 重新配对 |
| `4008` | 触发限流 | 等一分钟再试 |
| `4410` | 配对通道已关闭 | 重新生成配对链接 |

### 4.4 常见错误文案

| 现象 | 原因 |
|------|------|
| Web 端报「配对链接无法识别」 | 粘贴的不是完整链接，或不是 `v=3` 格式 |
| 主机端 `access list` 里 `code` 列显示 `(waiting for the device)` | 正常现象，Web 端不生成核对码；用 requestId 放行 |
| 超过 90 秒才执行 `access approve` | 请求已失效，重新走一遍配对 |
| 主机日志或 Web 端出现 `4400` | 主机登录了 Codync 账号（见 4.1 第 1 条） |
| 6 位短码在 Web 端无法解析 | 短码需云端解析，Web 端无云端；改用完整链接 |

---

## 五、验证与排错

### 5.1 Web 端自检

```bash
cd web
npm test           # Vitest 单元测试
npx tsc --noEmit   # 类型检查，应 exit 0
npm run build      # 静态导出
npm run lint       # ESLint
```

上面四项已在 `feat/web-client` 分支实跑（HEAD `7229660`）：Vitest **95/95**（16 个文件）、tsc exit 0、build **13 页**静态导出、ESLint 0 错 1 警（`app/layout.tsx:2` 的 `Geist_Mono` 未使用，本次未改动该文件）。

Playwright 冒烟（`npm run test:e2e`）需要能启动浏览器的环境，无头沙箱里跑不了；先执行 `npx playwright install chromium`。

### 5.2 主机端自检

```bash
cd host
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

> **未在本环境验证**：本开发环境无 Rust 工具链，上述三条未执行。`.github/workflows/host-ci.yml` 会在 CI 上跑这些检查。

### 5.3 真实配对联调

端到端联调必须有**真实运行的主机**：按第一节编译并运行 `codync-host`，再按第四节在 Web 端完成配对。

> 「Web 端与主机端能配对成功」这一点，在本仓库文档中属于**协议层与代码层结论**（字段、门禁、放行流程逐条核对过源码）。**尚未有人在真实主机上跑通一次完整配对**。「能连」目前的依据是兼容性判断，不是实测记录——首次部署请按第四节逐步验证，遇到 `4400` 优先检查主机是否登录了云账号。

---

## 六、文档索引

Web 客户端的详细文档在 `web/docs/`（[索引](web/docs/README.md)）：

| 文档 | 内容 |
|------|------|
| [架构说明](web/docs/architecture.md) | 分层、数据流、目录职责 |
| [ADR-001：/channel E2E 直连](web/docs/adr/001-channel-e2e.md) | 为什么不做中间层 |
| [开发环境搭建](web/docs/development-setup.md) | 完整开发命令、目录速览、已知坑 |
| [API 参考](web/docs/api-reference.md) | 主机方法与权限边界（逐方法经源码核对） |
| [使用指南](web/docs/user-guide.md) | 各功能怎么用 |
| [首次连接教程](web/docs/first-connection.md) | 从零到连上 |
| [FAQ](web/docs/faq.md) | 常见问题 |
| [贡献指南](web/docs/contributing.md) | 改代码的规矩与提交规范 |

主机端上游文档见 [leepokai/Codync 的 `docs/`](https://github.com/leepokai/Codync)（本仓库未附带）。

## 许可

[Apache-2.0](LICENSE)。另见 [NOTICE](NOTICE)、[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、[TRADEMARK.md](TRADEMARK.md)。
