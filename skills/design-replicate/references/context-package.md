# 上下文包调用与读取

## Provider 与凭据

先让 `design-context` registry 根据 design-platform URL 选择 adapter，或使用用户明确给出的 `--provider`。只在 cache miss 且 adapter 必须访问平台时检查该 provider 的环境变量。第一版 Figma adapter 使用 `FIGMA_TOKEN`；不得使用命令行 Token，也不得回显其值。其他 provider 未来由各自 adapter 定义凭据。

## 命令顺序

Agent 始终使用 `--json`，把 stdout 解析为单一 JSON envelope：

```bash
design-context prepare "$DESIGN_URL" --output "$CONTEXT_ROOT" --json
design-context validate-package "$PACKAGE_DIR" --json
design-context inspect "$PACKAGE_DIR" --json
design-context render "$PACKAGE_DIR" --compare --json
```

`PACKAGE_DIR` 只能来自 prepare 的 `data.packageDirectory`，并确认位于预期 output root。render 是可选辅助，不得代替目标应用截图。

## 状态门禁

- `complete`：可以继续。
- `partial`：逐项检查 diagnostic；只对 `retryable: true` 安全重试一次 `--force`。仍 partial 时，只有缺失项不阻止实现才继续并记录限制。
- `invalid`：修改目标项目之前停止。

根截图、`design.json`、`source/raw.json` 或 schema v1 manifest 缺失均按 invalid。鉴权、结构和文件系统错误不能用 `--force` 掩盖。

## 渐进读取

1. 读取 `AI_CONTEXT.md` 建立导航。
2. 查看 manifest 声明的 screenshot；后缀不固定。
3. 按相关节点 ID 定向读取 `design.json`，不把完整文件粘贴进上下文。
4. 只查看相关 `assets/`。
5. 按需读取 `styles.json` 与 `components.json`。

CLI 不具备图片识别能力，不生成相似度或视觉结论。必须由多模态 Agent 查看原稿与真实页面截图。不得保存或输出原始图片 bytes、base64、provider Token 或 signed asset URL。
