# `/channel` 官方向量 ↔ 线字段映射（Web 端 ChannelTransport 实现基线）

> 数据来源：`docs/reference/fixtures/remote-relay-vectors.json`（仓库内，与主机 `host/src/remote/crypto.rs` 单测同源）。
> 类型定义：`web/packages/shared/src/api-types.ts`。协议规格：`web/docs/api-reference.md` §5.1。

## 全局约定

- **所有二进制值 = base64url、无填充**（`crypto.rs:27` `URL_SAFE_NO_PAD`）——JS 端 `btoa` 是标准 base64，须自行转换。
- 私钥字段为 32 字节 seed/scalar，仅用于复现向量，**不得**用于生产。
- 加密帧内的明文消息即 §5.1 的请求/应答封套：`{"id","m","b"}` / `{"id","r"}` / `{"id","err"}` / `{"id","sub"}`。

## 1. `keys` — 测试身份（勿用于生产）

| 向量键 | 对应线字段/用途 | 字节数 |
|--------|----------------|--------|
| `deviceSignPub` | `hello.dk`（设备 Ed25519 公钥） | 32 |
| `hostSignPub` | 验证 `welcome.sig` 的主机公钥（配对 QR 的 `signKey` pin） | 32 |
| `hostSignSeed` / `deviceSignSeed` | 测试签名私钥 | 32 |
| `hostBoxPub` / `hostBoxPriv` | 主机 X25519 身份 | 32 |
| `computerId` | `cid_raw`（握手签名输入的第一段） | 16 |

## 2. `handshake` — ChannelHello / ChannelWelcome 字节基线

| 向量键 | 线字段 | 字节 | 规格出处 |
|--------|--------|------|----------|
| `deviceEphPub` | `hello.ek` | 32 | channel.rs:285 |
| `n` | `hello.n` | 32 | channel.rs:286 |
| `hs1SignInput` | Ed25519 签名输入 = `hs1_input(cid, dk, ek_d, n)` | 变长 | crypto.rs:105 |
| `hs1Sig` | `hello.sig` | 64 | channel.rs:292 |
| `hostEphPub` | `welcome.ek` | 32 | channel.rs:303 |
| `transcriptHash` | `sha256("codync/hs2/v1" ‖ cid ‖ dk ‖ ek_d ‖ n ‖ ek_h)` | 32 | crypto.rs:110-112 |
| `hs2Sig` | `welcome.sig`（主机对 transcriptHash 的签名，客户端必须验证） | 64 | channel.rs:304 |
| `sharedSecret` | X25519 ECDH 输出 | 32 | crypto.rs:120 |
| `prk` | HKDF-Extract(salt = transcriptHash, ikm = sharedSecret) | 32 | crypto.rs:121 |
| `kD2H` / `kH2D` | HKDF-Expand(prk, `"codync/d2h/v1"` / `"codync/h2d/v1"`, 32) | 32×2 | crypto.rs:120-127 |
| `deviceEphPriv` / `hostEphPriv` | 测试临时私钥 | 32 | — |

## 3. `frames` — seal / open 回归（3 条：d2h/c0/final · h2d/c0/final · d2h/c1/more）

| 向量键 | 说明 |
|--------|------|
| `dir` | 用哪把方向密钥（`d2h` → `kD2H`，`h2d` → `kH2D`） |
| `c` | 帧计数器，从 0 起（每方向独立） |
| `final` | flag：明文首字节 `0x00`=final / `0x01`=more（crypto.rs:24-25） |
| `message` | 明文 JSON 字符串，如 `{"id":1,"m":"hello","b":{}}` |
| `plaintext` | AEAD 明文 = `flag字节 ‖ message 的 UTF-8` |
| `d` | AEAD 密文：ChaCha20-Poly1305(key=方向密钥, nonce=`00000000‖c_be8`, aad=`"codync/frame/v1"‖c_be8`)（crypto.rs:129-146） |

线上封套：`{"t":"f","c":<c>,"d":"<b64url d>"}`（crypto.rs:186）＝ `ChannelFrame`。单 chunk ≤256 KiB（crypto.rs:20），帧计数达 2³² 必须重连换钥（crypto.rs:22），空消息也产生一帧（crypto.rs:174）。

## 4. 配对相关（认证流程用）

| 组 | 内容 |
|----|------|
| `sas` | `deviceNonce`/`hostNonce`(32B) → `commit` → 6 位 `code`（人眼比对） |
| `pairCheck` | 6 位核对码样例 |
| `pairing` | 配对码 `code`(16B b64url) + `offerId`（对应 `PairingInfo.pairingUrl` 内的码） |

## 5. Phase 1 暂不用（列名备查）

`claim`（设备认领 canonical/sig）· `push`（X25519 封推送票）· `mailbox`（私中继信箱）· `requestSig`（HTTP 请求签名）· `acl`（网络名单签名）。

## 测试用法（@试金）

Vitest 直接 `import` 该 JSON：`keys` 构造身份 → `handshake` 逐字节断言 `hs1SignInput`/`hs1Sig`/`transcriptHash`/`kD2H`/`kH2D` → `frames` 断言 `seal(明文)==d` 与 `open(d)==(final, 明文)`，覆盖计数器、flag、空消息三个分支。

---
*生成：砚台（数据）· 2026-11-03 · 逐字节对照 crypto.rs/channel.rs 源码核实。*
