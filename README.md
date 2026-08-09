# design-context-bridge

`design-context-bridge` 把设计平台节点转换为可缓存、可校验、可供多模态 Codex 和 Claude Code 使用的本地上下文包。确定性的 Node.js CLI 负责下载、归一化、资产缓存和结构校验；Agent 负责图片理解、页面实现、真实浏览器截图差异分析和业务回归。

当前版本内置 Figma adapter，Core、package schema、CLI 与 Skill 均保持 provider-neutral。项目通过 Git 仓库和用户级安装脚本分发，不发布 npm registry 包。

## 团队安装

要求 Node.js 20+、npm 和 Git。克隆仓库后执行唯一受支持的安装入口：

```bash
git clone git@github.com:yinghuzhu/design-context-bridge.git
cd design-context-bridge
./scripts/install.sh
```

脚本会执行依赖安装、密钥扫描、类型检查、lint、测试和构建，然后把运行时复制到 `~/.local/share/design-context-bridge`，把命令安装到 `~/.local/bin`，并默认同时安装：

- Codex：`~/.agents/skills/design-replicate`
- Claude Code：`~/.claude/skills/design-replicate`

如果 `~/.local/bin` 尚未进入当前 shell 的 PATH，按安装结果提示执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
design-context --version
```

只安装一端 Skill：

```bash
./scripts/install.sh --client codex
./scripts/install.sh --client claude
```

更新工具：

```bash
git pull --ff-only
./scripts/install.sh
```

安装内容是副本，移动源码仓库不会破坏已安装命令。重复安装只更新带本工具所有权标记的运行时、命令和 Skill；遇到未知同名目录会安全停止，不覆盖用户文件。脚本不使用 `sudo`，也不修改 `.zshrc`、`.bashrc` 等 shell 配置。

Codex 显式调用 `$design-replicate`，Claude Code 调用 `/design-replicate`；符合 Skill 描述的自然语言也可触发。

## Figma 凭据

Figma adapter 只从运行环境读取 `FIGMA_TOKEN`。请在仓库外通过当前 shell、密码管理器或团队批准的秘密管理方式配置：

```bash
export FIGMA_TOKEN='<your-token>'
```

安装脚本不接收该参数，也不会把它写入源码、安装目录、日志、JSON、缓存或迁移状态。

## 准备上下文包

```bash
design-context prepare \
  'https://www.figma.com/design/<fileKey>/<title>?node-id=1-2' \
  --output .design-context/packages \
  --format png \
  --scale 2 \
  --json
```

未指定 `--provider` 时，registry 根据 URL 选择 adapter。有效 fingerprint 缓存可在没有 Token 时复用。

设计稿内容可能已改变但 URL 未改变时显式刷新：

```bash
design-context prepare "$DESIGN_URL" \
  --output .design-context/packages \
  --refresh \
  --json
```

`--refresh` 是更清晰的团队入口，和兼容参数 `--force` 具有相同语义。新任务或用户明确说明设计已更新时使用 refresh；只有确认设计来源未变化的持续迁移才复用缓存。

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

## 目标项目状态策略

迁移事实和生成资产使用不同策略：

- `.design-context/migration.json`：经过项目审查后可以提交，保存已确认且非敏感的迁移事实。
- `.design-context/packages/`：设计截图、结构和素材的本地缓存，默认忽略，不提交。
- `.design-context/evidence/`：本地或 CI 验证证据，默认忽略；只有目标项目明确批准时才提交。

仓库提供可复制的 [templates/design-context.gitignore](templates/design-context.gitignore)。Skill 不得自行提交 packages 或 evidence。

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

- `manifest.json`：provider、规范化安全 URL、export 参数、fingerprint、相对路径、资产映射和 diagnostics。
- `design.json`：规范化节点、几何、文字、样式、组件和资产引用。
- `source/raw.json`：adapter 清理敏感字段后的平台原始数据。
- screenshot：视觉真值；实际后缀由 manifest 声明。
- renderer 输出：仅用于辅助观察，不能作为视觉通过证据。

状态为 `complete`、`partial` 或 `invalid`。根截图或核心 JSON 失败不会发布；非关键资产失败可发布 partial。下载在同父目录 staging 中完成，校验后原子替换，失败保留旧缓存。

## Agent 工作边界

完整复刻必须由具备图片理解能力的多模态 Agent 完成。用户或适用项目说明必须明确目标仓库、目标页面/路由和 design-platform URL；迁移任务还要明确已批准新版参考和受保护业务行为。Agent 不扫描全仓猜测新旧页面。

推荐流程：

1. `design-context prepare`、`validate-package` 和 `inspect`。
2. 查看 manifest screenshot，再按需定向读取 `design.json`、assets、styles 和 components。
3. 复用目标仓库既有技术栈和已批准组件，保护 API、路由、状态、校验、错误处理及数据流。
4. 启动真实应用；优先当前浏览器，无控制能力时使用外部 Playwright MCP 或项目现有浏览器测试。
5. 多模态 Agent 对比原稿与真实页面截图并迭代，直到无高、中优先级差异。
6. 任何可能影响交互或业务流程的修改都运行相关验证。
7. 视觉和业务门禁全部通过后，才更新 `.design-context/migration.json` 并通知人工验收。

CLI 不进行图片识别、视觉评分或最终验收判断，也不提供自有 MCP/HTTP 服务。

## 开发与安全检查

```bash
npm ci
npm run check
```

`npm run check` 包含 tracked-file 密钥扫描、typecheck、ESLint、Vitest 和构建。密钥扫描只报告可疑文件路径，不输出命中的值。完整架构与安全边界见 [docs/design.md](docs/design.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

Python 可行性原型保存在远程分支 `archive/python-v0.2`；当前版本不提供 Python CLI、旧 schema 或旧状态目录兼容层。

## License

MIT
