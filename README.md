# design-context-bridge

`design-context-bridge` 把设计平台节点转换为可缓存、可校验、可供多模态 Codex 和 Claude Code 使用的本地上下文包。确定性的 Node.js CLI 负责下载、归一化、资产缓存和结构校验；Agent 负责图片理解、页面实现、真实浏览器截图差异分析和业务回归。

当前版本内置 Figma adapter，Core、package schema、CLI 与 Skill 均保持 provider-neutral，后续可增加其他设计平台 adapter。

## 安装

要求 Node.js 20+：

```bash
npm install -g design-context-bridge
design-context --help
design-replicate-install --client both
```

也可以不做全局安装：

```bash
npx design-context-bridge --help
npx design-context-bridge prepare "$DESIGN_URL" --output .design-context/packages --json
```

Skill 安装器默认建立绝对符号链接：Codex 使用 `~/.agents/skills/design-replicate`，Claude Code 使用 `~/.claude/skills/design-replicate`。使用 `--client codex` 或 `--client claude` 只安装一端；使用 `--copy` 复制完整 Skill 树。安装器会先检查所有目标，不覆盖目录或 broken symlink，失败只回滚本次创建的路径。

Codex 显式调用 `$design-replicate`，Claude Code 调用 `/design-replicate`；符合 Skill 描述的自然语言也可触发。

## 准备上下文包

Figma adapter 只从环境变量读取 `FIGMA_TOKEN`。Token 不进入参数、日志、JSON、缓存或迁移状态：

```bash
export FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxx

design-context prepare \
  'https://www.figma.com/design/<fileKey>/<title>?node-id=1-2' \
  --output .design-context/packages \
  --format png \
  --scale 2 \
  --json
```

未指定 `--provider` 时 registry 根据 URL 选择 adapter。可显式指定 `--provider figma`；provider 与 URL 不匹配会直接报无效输入。有效 fingerprint 缓存可在没有 Token 时复用，`--force` 重建整个同键包。

只读与辅助命令：

```bash
design-context validate-package .design-context/packages/<package> --json
design-context inspect .design-context/packages/<package> --json
design-context status .design-context/packages/<package> --json
design-context render .design-context/packages/<package> --compare --json

design-context migration init /path/to/target-repo --json
design-context migration validate /path/to/target-repo --json
```

JSON 模式 stdout 始终只有一个 `{ok, command, status, data, diagnostics}` 对象；面向人的输出写 stderr。退出码：`0` 成功或可用 partial，`20` 无效包，`30` 无效输入，`40` 凭据缺失/鉴权失败，`50` 来源 API/网络失败，`60` 文件系统失败。

## 通用 package schema v1

```text
<output>/<provider>_<document>_<node>/
├── manifest.json
├── design.json
├── source/raw.json
├── screenshot.<png|jpg|svg>
├── AI_CONTEXT.md
├── styles.json
├── components.json
├── README.md
└── assets/
```

- `manifest.json`：provider、来源标识、安全 URL、export 参数、fingerprint、相对路径、资产映射和 diagnostics。
- `design.json`：Core 使用的规范化节点、几何、文字、样式、组件和资产引用。
- `source/raw.json`：adapter 清理敏感字段后的平台原始数据。
- screenshot：视觉真值；实际后缀由 manifest 声明。
- renderer 输出：只用于辅助观察，不能作为视觉通过证据。

状态为 `complete`、`partial` 或 `invalid`。根截图/核心 JSON/安全路径失败不会发布；非关键资产失败可发布 partial。下载在同父目录 staging 中完成，校验后原子替换，失败保留旧缓存。

## Agent 工作边界

完整复刻必须由具备图片理解能力的多模态 Agent 完成。用户或适用项目说明必须明确目标仓库、目标页面/路由和 design-platform URL；迁移任务还要明确已批准新版参考（首次迁移可明确为空）和受保护业务行为。Agent 不扫描全仓猜测新旧页面。

推荐流程：

1. `design-context prepare`、`validate-package` 和 `inspect`。
2. 查看 manifest screenshot，再按需定向读取 `design.json`、assets、styles 和 components。
3. 复用目标仓库既有技术栈和已批准组件，保护 API、路由、状态、校验、错误处理及数据流。
4. 启动真实应用；优先当前浏览器，无控制能力时使用外部 Playwright MCP 独立浏览器或项目现有浏览器测试。
5. 多模态 Agent 对比原稿与真实页面截图并迭代，直到无高、中优先级差异。
6. 任何可能影响交互或业务流程的修改都运行相关验证。视觉通过但业务失败时不得通知人工验收。
7. 工具门禁全部通过后，才更新 `.design-context/migration.json` 并通知人工验收。

CLI 不进行图片识别、视觉评分或最终验收判断，也不提供自有 MCP/HTTP 服务。

## 开发

```bash
npm ci
npm run check
npm pack --json --dry-run
```

架构与安全边界见 [docs/design.md](docs/design.md)。Python 可行性原型保存在远程分支 `archive/python-v0.2`；当前版本不提供 Python CLI、旧 schema 或旧状态目录兼容层。

## License

MIT
