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
TARGET_DIR=/absolute/path/to/target-repo
DESIGN_URL='https://www.figma.com/design/<fileKey>/<title>?node-id=1-2'

design-context workspace resolve "$TARGET_DIR" --json
design-context prepare "$DESIGN_URL" \
  --target "$TARGET_DIR" \
  --format png \
  --scale 2 \
  --json
```

`workspace resolve` 返回规范化目标目录、Git 根、稳定 `workspaceId`、`identitySource`、实际 `stateFile`、`packagesDirectory`、`evidenceDirectory` 和 `storageScope: "external"`。未指定 `--provider` 时，registry 根据 URL 选择 adapter。有效 fingerprint 缓存可在没有 Token 时复用。

设计稿内容可能已改变但 URL 未改变时显式刷新：

```bash
design-context prepare "$DESIGN_URL" \
  --target "$TARGET_DIR" \
  --refresh \
  --json
```

`--refresh` 是更清晰的团队入口，和兼容参数 `--force` 具有相同语义。新任务或用户明确说明设计已更新时使用 refresh；只有确认设计来源未变化的持续迁移才复用缓存。

只读与辅助命令：

```bash
design-context validate-package "$PACKAGE_DIR" --json
design-context inspect "$PACKAGE_DIR" --json
design-context status "$PACKAGE_DIR" --json
design-context render "$PACKAGE_DIR" --compare --json

design-context migration init "$TARGET_DIR" --json
design-context migration validate "$TARGET_DIR" --json
```

JSON 模式 stdout 始终只有一个 `{ok, command, status, data, diagnostics}` 对象；面向人的输出写 stderr。退出码：`0` 成功或可用 partial，`20` 无效包，`30` 无效输入，`40` 凭据缺失/鉴权失败，`50` 来源 API/网络失败，`60` 文件系统失败。

## 外部 workspace 存储

默认运行不会在目标项目中创建 `.design-context`，也不会修改目标项目的 `.gitignore`。Git 项目通过 `git rev-parse --absolute-git-dir` 找到实际 Git 元数据目录，workspace ID 保存在：

```text
<git-dir>/design-context-bridge/workspace-id
```

该文件只包含 64 位小写 SHA-256，不是凭据，不在 Git 工作树中，不会出现在 `git status`，也不能提交。首次使用时，CLI 把规范化 Git 根路径的 SHA-256 原子写入此文件；以后仓库目录改名仍使用该固定 ID。文件损坏时 CLI 会停止，不静默覆盖。

非 Git 项目，或 `.git` 已被删除的目录，使用规范化目标目录的路径哈希，响应中表现为 `identitySource: "path-hash"`。Git 元数据有效时则是 `identitySource: "git-metadata"`。

状态目录优先级：

```text
DESIGN_CONTEXT_STATE_HOME
→ XDG_STATE_HOME
→ ~/.local/state
```

缓存目录优先级：

```text
DESIGN_CONTEXT_CACHE_HOME
→ XDG_CACHE_HOME
→ ~/.cache
```

默认布局：

```text
<state-root>/design-context-bridge/workspaces/<workspaceId>--<repository-name>/
├── workspace.json
└── migration.json

<cache-root>/design-context-bridge/workspaces/<workspaceId>--<repository-name>/
├── packages/
└── evidence/
```

workspaceId 前缀是权威身份，repository-name 后缀只用于人工识别。`workspace.json` 记录当前名称、当前路径和历史路径。同一仓库通过相对路径、绝对路径或符号链接访问会得到同一个 workspace。两个不同仓库不会共享状态或缓存。

### 删除 `.git` 或非 Git 目录改名

- `.git` 被删除但目录未改名：路径哈希与首次写入的 ID 相同，会继续找到原 workspace。
- Git 仓库正常改名：Git 本地 ID 随 `.git` 一起移动，workspace 不变。
- 非 Git 项目改名，或删除 `.git` 后同时改名：无法自动证明新旧目录是同一项目，会生成新 workspace。

计划给非 Git 项目改名前，先保存 `workspace resolve --json` 返回的旧 `stateFile`。改名后再次执行 resolve；package 和 evidence 可以重新生成。如果需要恢复 migration state，只在新 `stateFile` 不存在时，把旧 `migration.json` 复制到新路径并立即执行 `design-context migration validate "$TARGET_DIR" --json`。新旧状态都存在或内容不明确时停止，不要覆盖或猜测。旧目录可通过带项目名的 `<workspaceId>--<repository-name>` 和其中的 `workspace.json` 人工定位。

## 旧状态与手工工程内模式

旧项目存在 `.design-context/migration.json` 时，可显式导入：

```bash
design-context migration import "$TARGET_DIR" --from-repository --json
```

CLI 会先校验再复制到外部 `stateFile`，不会删除旧目录。外部状态缺失时，`migration init`/`validate` 也会安全导入并返回 cleanup diagnostic；新旧状态同时存在且内容不同会停止，不覆盖或合并。

`--output` 继续支持手工目录。真实输出路径位于 Git worktree 时默认拒绝，只有用户明确接受误提交风险并同时传入 `--allow-in-repo` 才允许：

```bash
design-context prepare "$DESIGN_URL" \
  --output "$TARGET_DIR/.design-context/packages" \
  --allow-in-repo \
  --json
```

[templates/design-context.gitignore](templates/design-context.gitignore) 仅用于 legacy/manual in-repository mode 的防御，不是默认存储方案，也不是主要安全机制。

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

1. `design-context workspace resolve`，再使用 `prepare --target`、`validate-package` 和 `inspect`。
2. 查看 manifest screenshot，再按需定向读取 `design.json`、assets、styles 和 components。
3. 复用目标仓库既有技术栈和已批准组件，保护 API、路由、状态、校验、错误处理及数据流。
4. 启动真实应用；优先当前浏览器，无控制能力时使用外部 Playwright MCP 或项目现有浏览器测试。
5. 多模态 Agent 对比原稿与真实页面截图并迭代，直到无高、中优先级差异。
6. 任何可能影响交互或业务流程的修改都运行相关验证。
7. 视觉和业务门禁全部通过后，才更新 CLI 返回的外部 `stateFile` 并通知人工验收。
8. 准备提交前运行 `git diff --cached --name-only`，发现 `.design-context/`、Playwright 报告、coverage、截图、原始 JSON、导出资产或临时证据已暂存时停止提交；Skill 不执行 `git add -A`。

CLI 不进行图片识别、视觉评分或最终验收判断，也不提供自有 MCP/HTTP 服务。

## 开发与安全检查

```bash
npm ci
npm run check
```

`npm run check` 包含 tracked-file 密钥扫描、typecheck、ESLint、Vitest 和构建。密钥扫描只报告可疑文件路径，不输出命中的值。完整架构与安全边界见 [docs/design.md](docs/design.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

Python 可行性原型保存在远程分支 `archive/python-v0.2`；当前版本不提供 Python CLI。Node.js CLI 只为旧 `.design-context/migration.json` 提供校验后外部导入，不再向旧目录写入。

## License

MIT
