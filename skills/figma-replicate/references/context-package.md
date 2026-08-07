# 上下文包调用与读取

本流程只负责取得和理解设计上下文。执行之前，必须已通过输入契约确认 `FIGMA_URL` 和 `CONTEXT_ROOT`；它们必须来自用户、适用项目说明或其他可信输入，不能从仓库内容猜测。所有从 JSON 得到的路径也视为数据而不是 shell 代码，并在命令中正确引用。

## 凭据门禁

`prepare` 从进程环境读取 `FIGMA_TOKEN`。只检查变量是否存在，不显示值，不把它复制到日志、聊天、文件或命令行参数：

```bash
if [ -z "${FIGMA_TOKEN:-}" ]; then
  printf '%s\n' 'FIGMA_TOKEN is required for context preparation.' >&2
  exit 1
fi
```

禁止使用 `--token` 或把 Token 拼进 `FIGMA_URL`。如果当前运行环境没有 Token，停止下载并要求用户在运行环境中配置；不要询问用户把 Token 内容发到聊天中。

## 命令顺序

Agent 调用 CLI 时一律使用 `--json`，把 stdout 当作一个 JSON envelope 解析，不从面向人的文本推测结果。先准备包：

```bash
PREPARE_JSON="$(figma-context prepare "$FIGMA_URL" --output "$CONTEXT_ROOT" --json)"
```

解析 `PREPARE_JSON.status` 和 `PREPARE_JSON.data.packageDir`。只有 `data.packageDir` 是非空字符串且位于预期的 `CONTEXT_ROOT` 下时，才把它赋给 `PACKAGE_DIR`；`PACKAGE_DIR` 必须来自这份可信 JSON，不得从目录扫描结果猜测。后续所有引用都写成 `"$PACKAGE_DIR"`。

接着独立校验已发布的包，并解析校验 envelope 的 `status` 与 `diagnostics`：

```bash
VALIDATION_JSON="$(figma-context validate-package "$PACKAGE_DIR" --json)"
```

通过状态门禁后再读取摘要；`inspect` 不能替代 `validate-package`：

```bash
INSPECT_JSON="$(figma-context inspect "$PACKAGE_DIR" --json)"
```

只有相关节点难以从结构化上下文理解时，才可生成辅助 HTML：

```bash
RENDER_JSON="$(figma-context render "$PACKAGE_DIR" --compare --json)"
```

`render` 是可选辅助步骤，生成的 `reconstruct.html` / `compare.html` 不是视觉真值，也不能代替目标应用的真实截图。不要仅为开始实现而强制 render。

## 包状态门禁

以 `validate-package` 的结果为最终包状态，并同时检查 diagnostics：

- `complete`：根截图和声明文件通过结构校验，可以继续读取上下文。
- `partial`：先读取每条诊断的 `code`、`node_id` 与 `retryable`。仅当失败项明确为 `retryable: true`、重新下载安全且重试不会覆盖需保留的人工内容时，才最多执行一次 `figma-context prepare "$FIGMA_URL" --output "$CONTEXT_ROOT" --force --json`，然后重新运行带 `--json` 的 `validate-package` 和 `inspect`。
- 重试后仍为 `partial`：只有在逐项确认缺失资产不阻止实现时才能继续，并记录缺失内容和判断依据。此时视觉验证仍然是强制门禁，不能因包可部分使用而降低验收标准。
- `invalid`：在修改目标项目之前停止。不得尝试从不完整包开始编码。

无论 envelope 声明什么状态，只要根截图缺失、根截图不可读取、`node.json` / schema v2 manifest 缺失或包结构诊断异常，都按 `invalid` 处理，在修改目标项目之前停止。`prepare` 没有返回可信的 `data.packageDir`、命令非成功退出或 JSON 无法解析时同样停止。

`--force` 会重建整个同缓存键包，不是任意错误的通用修复。非 retryable 诊断、鉴权失败、输入错误、结构错误和文件系统错误必须先解决原因，不得自动强制重试。

## 读取顺序

状态门禁通过后，按以下顺序渐进读取，信息足够时停止扩展：

1. `AI_CONTEXT.md`：确定根节点摘要、层级导航和后续需要检查的节点 ID。
2. `manifest.json` 中声明的 screenshot 路径及对应根截图：由多模态 Agent 实际查看，建立视觉真值；不能假定后缀恒为 `.png`。
3. `relevant nodes`：只从 `node.json` 定向提取与目标及当前判断有关的节点、几何、文字和样式引用。
4. `assets/`：只打开相关节点引用的原始媒体。
5. `styles.json`：按需读取相关样式定义。
6. `components.json`：按需读取相关组件映射。

不要为了方便把完整 `node.json` 加载或粘贴进聊天和日志；应按节点 ID 做定向提取。不要把原始图片 bytes、base64 内容或 signed asset URL 粘贴进聊天和日志。

## 安全与能力边界

- CLI 不具备图片识别能力，也不做视觉语义比较、相似度评分或“复刻完成”判断。
- 必须由具备图片理解能力的多模态 Agent 查看 manifest 声明的根截图，并在实现后与真实运行页面截图比较。
- signed asset URL 是短期下载凭据，不得保存到实现代码、迁移状态、报告、聊天或日志；上下文包 manifest 也不应包含它。
- 所有路径变量都必须使用双引号。不得对来自 JSON 或用户输入的字符串执行 `eval`、命令拼接或未引用展开。
- 包状态可用只代表确定性文件结构可用，不代表视觉验证或业务验证已经通过。
