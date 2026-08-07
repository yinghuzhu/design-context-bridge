# figma-context-bridge

`figma-context-bridge` 把指定 Figma 节点下载为可复用的本地上下文包，供 Codex、Claude Code 等多模态 Agent 在目标仓库中复刻页面。Figma API 访问、资产缓存、上下文提取和辅助 HTML 渲染由确定性的 Core/CLI 完成；视觉理解、截图语义比较、代码实现与业务回归由 Agent 完成。

## 安装

要求 Python 3.10+，下载时需要具有 `File content` 只读权限的 Figma Personal Access Token。

```bash
python3 -m venv venv
source venv/bin/activate
pip install -e '.[test]'
export FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxx
figma-context --help
```

生产运行依赖只有 `requests>=2.31`；pytest 位于 `test` extra，不是运行时依赖。

## Agent 优先的 CLI

```bash
# 下载、校验并生成 AI_CONTEXT.md / styles.json / components.json
figma-context prepare \
  'https://www.figma.com/design/<fileKey>/<title>?node-id=1-2' \
  --output ./downloads --format png --scale 2 --json

# 强制刷新同一缓存键；旧资产通过 staging + 原子发布清理
figma-context prepare URL --output ./downloads --force --json

# 以下只读命令都不需要 FIGMA_TOKEN
figma-context inspect downloads/<fileKey>_1-2 --json
figma-context validate-package downloads/<fileKey>_1-2 --json
figma-context status downloads/<fileKey>_1-2 --json

# 生成辅助 HTML，可选并排对比页
figma-context render downloads/<fileKey>_1-2 \
  --output /tmp/reconstruct.html --compare --json

# 在目标仓库维护跨会话迁移状态
figma-context migration init /path/to/target-repo --json
figma-context migration validate /path/to/target-repo --json
```

`--json` 模式的 stdout 始终只有一个 JSON 对象，结构稳定为：

```json
{
  "ok": true,
  "command": "status",
  "status": "complete",
  "data": {},
  "diagnostics": []
}
```

进度和面向人的提示写入 stderr。退出码契约：

| 退出码 | 含义 |
|---:|---|
| `0` | `complete`、可用的 `partial`，或命令成功 |
| `20` | 无效上下文包 |
| `30` | 无效输入或迁移状态 |
| `40` | Token 缺失或 Figma 鉴权失败 |
| `50` | Figma API 或网络失败 |
| `60` | 文件系统失败 |

## 上下文包

```text
downloads/<fileKey>_<nodeId>/
├── node.json
├── screenshot.png          # 视觉事实来源，后缀随 --format 改变
├── manifest.json           # schemaVersion: 2
├── AI_CONTEXT.md
├── styles.json
├── components.json
├── reconstruct.html        # 辅助观察，不是实现事实来源
├── compare.html            # 可选
├── README.md
└── assets/
```

包状态有三种：

- `complete`：根节点截图和声明的资产完整。
- `partial`：根节点截图可用，但部分非关键资产失败；诊断包含节点和重试信息，仍返回退出码 `0`，Agent 可以继续工作。
- `invalid`：缺少根截图、节点数据、schema v2 manifest，或包结构不安全；不能渲染，返回退出码 `20`。

旧版 manifest 没有 `schemaVersion` / `status`，会如实判定为 `invalid`，不会伪装成 schema v2。使用有效 Token 重新执行 `prepare --force` 可生成新包。

manifest 不保存 Figma Token 或临时签名资产 URL。下载在 staging 目录完成并校验后原子发布；失败不会覆盖上一份有效缓存。

## 多模态 Agent 边界

Core/CLI 不包含图片语义识别，不判断“两个页面是否看起来一致”，也不产生视觉相似度分数。完整复刻必须由具备图片理解能力的多模态 Agent 执行：

1. 读取 Figma 根截图、`AI_CONTEXT.md`、必要节点和资产。
2. 根据用户明确指定的目标页面、已批准新版参考页面和受保护业务流程，限界扫描目标仓库。
3. 实现页面并启动真实运行环境。
4. 通过现有浏览器、浏览器自动化或 Playwright MCP 截取实际页面。
5. 由多模态 Agent 比较 Figma 截图和运行截图并迭代；可能影响交互或既有业务时必须执行对应回归验证。
6. 工具验证通过后再通知人工验收。

迁移上下文保存在目标仓库的 `.figma-context/migration.json`。Agent 不应随意扫描整个仓库，也不能自行猜测哪些页面属于新版；这些信息必须来自用户、项目说明或用户已确认的迁移状态。

## 旧脚本兼容

已有命令仍可使用，并直接调用同一套 Core API：

```bash
# 下载 schema v2 包
python scripts/figma_download.py URL -o ./downloads --format png --scale 2

# 渲染已有包
python scripts/render_html.py downloads/<fileKey>_<nodeId> --compare

# 下载或复用缓存、生成上下文、渲染，成功后才打开浏览器
python scripts/figma_pipeline.py URL --no-open
```

`figma_pipeline.py` 不再通过子进程参数传递 Token。`complete` 和 `partial` 都会继续渲染，`partial` 的缺失资产会打印到 stderr；只有渲染成功后才会尝试打开浏览器。`figma_download.py --no-screenshot` 为弃用兼容参数，schema v2 始终保留根截图。

## 渲染定位

辅助渲染器把文本和基础 Frame/Rectangle 转为 HTML/CSS，把无法可靠转换的矢量或 IMAGE fill 引用为 `assets/` 文件。它适合快速观察结构和生成并排页面，但不能替代多模态 Agent 对真实目标应用截图的验收。

完整需求与技术说明见 [docs/design.md](docs/design.md)，实施设计与计划见 [docs/plans](docs/plans)。

## License

MIT
