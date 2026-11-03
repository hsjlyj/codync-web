# Codync Web 客户端 — 文档索引

> 基线：Codync v2.38.0 · 更新：2026-11-03 · 维护：榫卯（Writer）
> 项目处于 **Phase 0（脚手架）**。标「草稿」的文档描述的是目标行为，功能尚未实现。
> 唯一工作树：`/workspace/codync-2.38.0/`（分支 `feat/web-client`）。

## 文档目录

| 文档 | 读者 | 状态 |
|------|------|------|
| [架构说明](architecture.md) | 开发者 | 现行（遵循 ADR-001） |
| [开发环境搭建](development-setup.md) | 开发者 | 现行 |
| [API 参考](api-reference.md) | 开发者 | 现行（砚台维护，逐方法源码核对） |
| [ADR-001：/channel E2E 直连](adr/001-channel-e2e.md) | 全员 | 已采纳（岚序落盘） |
| [贡献指南](contributing.md) | 全员 | 现行 |
| [使用指南](user-guide.md) | 用户 | 草稿（Phase 1 目标行为） |
| [首次连接教程](first-connection.md) | 用户 | 草稿（Phase 1 目标行为） |
| [FAQ](faq.md) | 用户 | 草稿 |

## 维护规则

- 文档与代码不一致时，**以代码为准**；发现不一致请告知榫卯修正。
- 用户文档（user-guide / first-connection / faq）在功能上线前必须按实际实现核对一遍再去掉「草稿」标记。
- 每个数字、版本、错误码都要能追溯到源码或真实运行结果；查不到的写「未确认」。
- 工作树约定（ADR-001）：`/workspace/codync-2.38.0/` 是唯一工作树；
  `/tmp/Codync-2.38.0/`、`/workspace/Codync-2.38.0/`、`/workspace/web/` 已废弃，勿再读写。
