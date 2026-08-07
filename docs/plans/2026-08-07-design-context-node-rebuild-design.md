# Design Context Bridge Node.js 重建设计

## 目标

将已经用 Python 验证可行的 Figma 页面上下文流程，重建为面向前端团队的 Node.js/TypeScript 产品。新产品不绑定 Figma 名称，但第一版只实现 Figma 设计平台适配器。

Python 版本没有正式用户和兼容负担。它只作为验证原型归档，不为其 CLI、package schema、状态目录或安装方式提供兼容层。

## 命名

| 层次 | 名称 |
|---|---|
| 项目与 npm 包 | `design-context-bridge` |
| CLI | `design-context` |
| Agent Skill | `design-replicate` |
| 目标仓库状态目录 | `.design-context/` |
| 第一版来源适配器 | `figma` |

没有选择 `design-replication-kit`，因为 CLI 不承担最终视觉判断；没有选择 `visual-context-bridge`，因为产品只面向结构化设计平台，不扩展到任意截图、PDF 或网页来源。

## Git 策略

在当前 Python 完成提交上创建并推送 `archive/python-v0.2`。`master` 保留完整 Git 历史，不重写、不强推；Node.js 重建通过正常提交替换当前实现。

Python 分支用于验证思路、对照行为和必要时定位回归，不作为 Node.js 版本的运行时依赖。

## 技术栈

- Node.js 20+
- TypeScript 与 ESM
- Vitest
- `tsup` 构建 npm CLI
- Node 内置 `fetch`、`fs/promises`、`crypto` 和 Web Streams
- npm `bin` 暴露 `design-context`

不使用 Python wrapper，不在 npm 包中携带 Python 解释器或平台二进制，也不建设自有 MCP 或 HTTP 服务。

## 架构

```text
design-replicate Skill
        ↓
design-context CLI
        ↓
通用 Core
  ├── package/schema/cache
  ├── context generation
  ├── migration state
  ├── auxiliary renderer
  └── source registry
          └── Figma adapter
```

Core 只能依赖通用设计类型和 `DesignSourceAdapter` 接口。Figma URL、API、Token、节点树和导出规则全部封装在 Figma adapter 内。

第一版使用内置 adapter registry，不实现动态第三方插件加载。未来新增 MasterGo、Pixso、Sketch 等平台时，增加 adapter 并注册即可。

### Adapter 职责

每个 adapter 负责：

- 判断是否支持输入 URL；
- 解析平台 document/node 标识；
- 使用平台专用环境变量鉴权；
- 获取原始设计数据、根截图和素材；
- 生成通用 `design.json`；
- 保存安全的 `source/raw.json`；
- 将平台错误转换为通用诊断；
- 删除 Token、Authorization 和签名素材 URL。

## 通用 context package schema v1

```text
<output>/<provider>_<document>_<node>/
├── manifest.json
├── design.json
├── source/
│   └── raw.json
├── screenshot.<format>
├── AI_CONTEXT.md
├── styles.json
├── components.json
├── README.md
└── assets/
```

`manifest.json` 使用全新的通用 `schemaVersion: 1`，至少包含：

- `source.provider`、安全来源 URL、document ID 和 node ID；
- `document` 与 `rawSource` 相对路径；
- 根截图相对路径；
- export format/scale；
- 确定性 fingerprint；
- `complete`、`partial`、`invalid` 状态；
- 节点到资产相对路径映射；
- 结构化 diagnostics。

`source/raw.json` 保留平台能力和排错信息；`design.json` 只表达 Core 需要的通用页面、节点、几何、文字、样式、组件引用和素材引用。转换不能成功的专有字段保留在 raw source，不应伪造通用语义。

## CLI

```text
design-context prepare URL --output DIR [--provider figma] [--format png|jpg|svg] [--scale N] [--force] [--json]
design-context inspect PACKAGE --json
design-context validate-package PACKAGE --json
design-context render PACKAGE [--output FILE] [--compare] --json
design-context status PACKAGE --json
design-context migration init TARGET_DIR --json
design-context migration validate TARGET_DIR --json
```

未指定 `--provider` 时，由 registry 根据 URL 选择 adapter。显式 provider 与 URL 不匹配时返回 invalid input，不静默换平台。

JSON envelope 保持 `{ok, command, status, data, diagnostics}`，但它是新产品契约，不声明与 Python CLI 兼容。退出码继续区分成功、无效包、无效输入、鉴权、来源 API 和文件系统错误。

## Skill 工作流

`design-replicate` 保留已经确认的工作原则：

- 必须具备多模态图片理解能力才能宣称完整复刻；
- 用户必须指定目标仓库、目标页面和设计平台 URL；
- 迁移时必须指定已批准新版参考和受保护业务行为；
- 禁止扫描全仓库猜测新旧页面；
- CLI 只负责确定性上下文，不做图片识别或视觉评分；
- Agent 获取真实运行截图并与原稿迭代比较；
- 可能影响交互或业务时必须验证；
- 工具门禁通过后才通知人工验收。

状态写入 `.design-context/migration.json`。因为没有正式用户，不读取或迁移 `.figma-context/`。

## 安全、失败与原子性

- 平台凭据只从 adapter 专用环境变量读取；Figma 使用 `FIGMA_TOKEN`。
- Token 不进入命令行、JSON、日志、context package 或迁移状态。
- 下载先写同父目录 staging，结构校验通过后原子发布。
- 根截图或核心文档失败时不发布 invalid package，并保留旧缓存。
- 非关键素材失败可发布 partial，同时记录 retryable 诊断。
- fingerprint 相同时可复用有效缓存；`--force` 重新构建整个包。
- 所有 package 相对路径必须验证不越界。

## 测试与验收

测试以新 TypeScript fixture 为准，不执行 Python/Node 输出兼容测试：

1. URL 与 adapter 选择单元测试；
2. Figma API batching、重试、鉴权和敏感信息测试；
3. schema、路径安全、partial/invalid 和原子回滚测试；
4. `design.json`、AI context、styles 和 components 确定性测试；
5. renderer 与动态截图后缀测试；
6. migration 状态和凭据拒绝测试；
7. CLI JSON envelope、退出码和无 Token 只读命令测试；
8. Skill、安装器和跨 Agent 场景契约测试；
9. npm pack、全新目录安装和 `npx` smoke；
10. 可选真实 Figma API smoke，以及多模态 Agent 对真实目标应用的视觉和业务验收。

发布门禁要求 TypeScript 测试、类型检查、lint、build、npm pack、CLI smoke 和 Skill 校验全部通过。旧 Python 下载包不能作为新版本通过依据。

## 实施顺序

1. 归档并推送 Python 分支；
2. 建立 Node.js/TypeScript package 与测试基础；
3. 定义通用类型、adapter 接口和 package schema；
4. 实现 Figma adapter；
5. 实现 downloader、context、renderer、migration 和 CLI；
6. 重命名并更新 Skill、安装器和 eval pack；
7. 删除 `master` 上的 Python 运行实现；
8. 完成 npm 与端到端发布验证。
