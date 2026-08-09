# Design Context Bridge 技术说明

## 定位

本项目为前端团队和多模态 Coding Agent 提供设计平台上下文。它解决平台 API 重复读取、临时素材 URL、跨 Agent 复用、目标仓库范围失控和验收证据不足的问题，但不替代 Agent 的图片理解与业务判断。

名称与入口：

| 层次 | 名称 |
|---|---|
| 私有 Node workspace | `design-context-bridge` |
| 团队安装入口 | `./scripts/install.sh` |
| Core CLI | `design-context` |
| Skill installer | `design-replicate-install` |
| Agent Skill | `design-replicate` |
| 目标仓库状态 | `.design-context/migration.json` |

## 架构

```text
design-replicate Skill
        ↓
design-context CLI
        ↓
provider-neutral Core
  ├── schema / validation / atomic cache
  ├── normalized design IR
  ├── context and auxiliary renderer
  ├── migration state
  └── source registry
          └── Figma adapter (v1)
```

Core 只依赖 `DesignSourceAdapter`、`DesignTarget`、`DesignDocument`、`RemoteAsset` 和通用 package schema。Figma URL、REST endpoint、`X-Figma-Token`、批处理与平台字段只存在于 `src/sources/figma/`。CLI composition root 注册内置 adapter；本版不做动态插件、自有 MCP 或 HTTP 服务。

## 数据流

1. Registry 根据 URL 或显式 provider 解析通用 target。
2. fingerprint 由 provider、documentId、nodeId、format 和 scale 确定性生成。
3. 有效同 fingerprint 缓存直接复用，不触发凭据或来源请求。
4. Adapter 获取原始节点，归一化为 `design.json`，并在内存中返回临时 `RemoteAsset` URL。
5. Core 在 destination 同父目录创建 staging，写入安全 raw/design，下载根截图和素材。
6. 根截图或核心结构失败则丢弃 staging；非关键素材失败形成 retryable diagnostic 和 partial 包。
7. schema 校验通过后，现有 destination 先移到 UUID backup，再原子发布 staging；任一步失败恢复旧缓存。
8. Core 离线生成 AI_CONTEXT、styles、components；renderer 只读取通用 IR。

Token、Authorization、Cookie、secret 和 signed asset URL 不得进入 manifest、raw、design、日志、JSON envelope 或迁移状态。

## Package schema v1

`manifest.json` 包含：

- `schemaVersion: 1`；
- `source.provider/url/documentId/nodeId`；
- `document`、`rawSource`、`screenshot` 安全相对路径；
- `export.format/scale` 与 64 位 SHA-256 fingerprint；
- `complete | partial | invalid`；
- node ID 到本地 asset 的映射；
- `{code, message, retryable, nodeId}` diagnostics。

校验拒绝绝对路径、空路径、`..` 越界、symlink 越界、JSON 结构错误、provider/document 不一致、缺少根节点或核心文件。声明的非核心资产缺失降级为 partial。

`design.json` 的节点至少包含 ID、name、type、visible、bounds、children 和 style，可选 text、assetRef、componentRef 与 componentProperties。平台不能可靠归一化的字段保留在安全 raw source，不伪造通用语义。

## Figma adapter

第一版支持 `/design/`、`/file/`、`/proto/` URL 和 `node-id`。API client：

- Token 只从 `FIGMA_TOKEN` 注入并仅用于 `api.figma.com`；资产下载不携带 Figma header。
- export 每批最多 40 个 ID；400/404/422 批失败降级逐节点，401/403、5xx 和网络错误保持类型。
- API 与资产请求默认 30 秒超时，单个资产默认限制为 50 MiB。
- 429/5xx/网络重试有固定次数和 Retry-After 上限，同时支持秒数和 HTTP-date。
- 返回 ID 统一为 colon 形式，签名 URL 只存在于短生命周期 `RemoteAsset`。
- normalizer 覆盖 geometry、visibility、layout、text、paint、stroke、radius、effect、component、instance、variant 与 asset reference。

## Context 与 renderer

`AI_CONTEXT.md` 是有界导航，不内联完整 raw/design、图片或远程 URL。`styles.json` 按稳定 JSON key 去重并记录 usage count/node IDs；`components.json` 记录定义、instance、variant property 和引用关系。生成结果字节确定。

renderer 对通用 bounds 做父子相对定位，转义 HTML/属性，引用 manifest 本地 asset，并支持 manifest 声明的 jpg/svg screenshot。它不导入 Figma 实现，不输出相似度或视觉通过结论。

## CLI 契约

```text
prepare URL --output DIR [--provider] [--format] [--scale] [--force] [--json]
inspect PACKAGE [--json]
validate-package PACKAGE [--json]
status PACKAGE [--json]
render PACKAGE [--output] [--compare] [--json]
migration init|validate TARGET_DIR [--json]
```

JSON stdout 恰好一个 envelope。只读命令无需 provider credential。错误码把无效包、无效输入、鉴权、来源和文件系统失败分开，错误消息在输出前脱敏。

## Migration 与 Skill

`.design-context/migration.json` schema v1 只保存已确认事实。approved reference 必须有 `approvedByUser: true`；validated target 必须同时有 `visualEvidence` 和 `businessEvidence`。递归拒绝 credential key，临时文件与 rename 保证替换失败时旧状态字节不变。

Skill 支持：

- `new`：新页面；
- `initial`：有旧业务但没有已批准新版参考；
- `continuation`：从有效状态继续；
- `adoption`：此前人工迁移过，由用户点名参考后接管。

每种模式都要求明确 target repository、target page/route 和 design-platform URL。迁移还要求 approved reference 与 protected business behavior，不允许全仓扫描猜测。

视觉验收必须取得真实运行页面截图，由多模态 Agent 同时查看原稿和实际图，逐项检查结构、几何、排版、颜色、素材、裁剪和状态。可能影响交互或业务时必须验证；视觉通过但业务失败仍为 blocked。全部工具门禁通过后才通知人工验收。

`.design-context/migration.json` 是可审查的迁移事实；`.design-context/packages/` 和 `.design-context/evidence/` 默认是本地或 CI 生成物。工具提供 `templates/design-context.gitignore`，不自动提交设计资产或验证截图。

## 仓库分发

项目设置为 private Node workspace，不发布 npm registry 包。团队成员克隆或更新 Git 仓库后运行 `./scripts/install.sh`。脚本完成依赖安装、完整质量门禁、构建、用户级 CLI 运行时复制以及 Codex/Claude Code Skill 安装，不需要 `sudo`，也不修改 shell 启动文件。

默认运行时路径为 `~/.local/share/design-context-bridge`，命令路径为 `~/.local/bin`。安装清单和 Skill 所有权标记只记录 schema、工具、版本和来源 commit，不读取或持久化环境凭据。重复安装只替换本工具拥有的路径，未知同名目标会停止。

## 发布门禁

- Node.js 20+；TypeScript ESM。
- typecheck、ESLint、Vitest、tsup 全部通过。
- `package.json` 保持 `private: true`，README 不提供 registry 发布或安装路径。
- 全新临时 HOME 运行 `./scripts/install.sh` 后，CLI help/version/validate/inspect/status/render 可运行。
- installer 在临时 Codex/Claude home 的默认 both、单客户端和 owned update 模式可运行。
- tracked-file 密钥扫描、Node 20/22 CI、typecheck、ESLint、Vitest 和 tsup 全部通过。
- Core 无 Figma implementation import，活跃产品无 Python runtime 或旧命名。

Python 原型仅保存在 `archive/python-v0.2`，Node 版不兼容旧 CLI、schema v2 或旧状态目录。
