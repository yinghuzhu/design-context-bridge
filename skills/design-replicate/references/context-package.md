# 上下文包调用与读取

## Provider 与凭据

先让 `design-context` registry 根据 design-platform URL 选择 adapter，或使用用户明确给出的 `--provider`。只在 cache miss 且 adapter 必须访问平台时检查该 provider 的环境变量。第一版 Figma adapter 使用 `FIGMA_TOKEN`；不得使用命令行 Token，也不得回显其值。其他 provider 未来由各自 adapter 定义凭据。

## 默认外部 workspace

Agent 始终使用 `--json`，先解析目标，再把 package 写入返回的外部 `packagesDirectory`：

```bash
design-context workspace resolve "$TARGET_DIR" --json
design-context prepare "$DESIGN_URL" --target "$TARGET_DIR" --json
design-context validate-package "$PACKAGE_DIR" --json
design-context inspect "$PACKAGE_DIR" --json
design-context render "$PACKAGE_DIR" --compare --json
```

`PACKAGE_DIR` 只能来自 prepare 的 `data.packageDirectory`，并确认位于同一响应的 `packagesDirectory` 下，且 `storageScope` 为 `external`。package、设计截图、`source/raw.json`、导出资产和上下文文件都不得复制进目标仓库。render 是可选辅助，不得代替目标应用截图。

新任务、用户明确说明设计已更新，或同一 URL 可能对应新版设计时增加 `--refresh`。只有 `continuation` 且可信状态确认设计来源未改变时才能复用缓存：

```bash
design-context prepare "$DESIGN_URL" --target "$TARGET_DIR" --refresh --json
```

## 显式工程内模式

`--output` 保留给手工目录。输出真实路径位于 Git worktree 时默认拒绝。只有用户明确要求并理解误提交风险后才能执行：

```bash
design-context prepare "$DESIGN_URL" \
  --output "$TARGET_DIR/.design-context/packages" \
  --allow-in-repo \
  --json
```

此时必须检查响应的 `storageScope: "in-repo"` 和风险 diagnostic，并在提交前执行生成物检查。单独传工程内 `--output` 不构成授权。

## 状态门禁

- `complete`：可以继续。
- `partial`：逐项检查 diagnostic；只对 `retryable: true` 安全重试一次 `--refresh`。仍 partial 时，只有缺失项不阻止实现才继续并记录限制。
- `invalid`：修改目标项目之前停止。

根截图、`design.json`、`source/raw.json` 或 schema v1 manifest 缺失均按 invalid。鉴权、结构和文件系统错误不能用 `--refresh` 掩盖。

## 渐进读取

1. 读取 `AI_CONTEXT.md` 建立导航。
2. 查看 manifest 声明的 screenshot；后缀不固定。
3. 按相关节点 ID 定向读取 `design.json`，不把完整文件粘贴进上下文。
4. 只查看相关 `assets/`。
5. 按需读取 `styles.json` 与 `components.json`。

CLI 不具备图片识别能力，不生成相似度或视觉结论。必须由多模态 Agent 查看原稿与真实页面截图。不得保存或输出原始图片 bytes、base64、provider Token 或 signed asset URL。
