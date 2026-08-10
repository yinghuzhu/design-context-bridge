# 迁移模式与跨会话状态

## 外部 workspace 与会话恢复

先读取适用说明，再解析和校验外部状态：

```bash
design-context workspace resolve "$TARGET_DIR" --json
design-context migration validate "$TARGET_DIR" --json
```

状态目录优先级是 `DESIGN_CONTEXT_STATE_HOME`、`XDG_STATE_HOME`、`~/.local/state`；缓存目录优先级是 `DESIGN_CONTEXT_CACHE_HOME`、`XDG_CACHE_HOME`、`~/.cache`。CLI 返回实际 `stateFile`、`packagesDirectory` 和 `evidenceDirectory`。只有 schema v1 校验通过的外部状态能作为事实来源。

Git 项目由 CLI 在实际 `<git-dir>/design-context-bridge/workspace-id` 保存本地固定 ID，不进入工作树，也不允许提交。首次 ID 是规范化 Git 根的路径哈希；响应 `identitySource` 为 `git-metadata`。目录改名后继续使用该 ID。若 `.git` 被删除但目录未改名，CLI 使用同一个 `path-hash` 找回原 workspace。

非 Git 项目始终使用 `path-hash`。非 Git 目录改名，或删除 `.git` 后同时改名时，不能扫描内容猜测身份；先按 README 保存旧 `stateFile` 映射，改名后解析新 workspace、重新生成 package/evidence，并只在无冲突时复制和校验 migration state。

新会话不等于新迁移；继续使用已批准参考、保护边界和验证证据，但当前目标及 design-platform URL 仍必须由用户或可信说明明确。不得因为需要跨会话恢复，就把状态或生成物放回业务仓库。

## 模式

- `new`：创建非迁移页面；仍需明确目标和设计 URL。
- `initial`：已有旧业务页但没有获批准的新版实现；approved references 必须明确为空。
- `continuation`：外部 workspace 已有有效状态；核实本次目标涉及的记录与当前代码，不扩大扫描。
- `adoption`：使用本工具前已经迁移部分页面但没有有效状态；用户必须点名可作为新版参考的页面。

不得扫描仓库自动判定模式、新旧页面或参考页面。来源冲突时由用户裁决。

## Schema v1 与事实演进

首次创建和后续校验：

```bash
design-context migration init "$TARGET_DIR" --json
design-context migration validate "$TARGET_DIR" --json
```

`stateFile` 包含 `schemaVersion`、`targets`、`approvedReferences`、`legacyBehaviorSources`、`protected`、`validations`。只有用户或适用说明确认的参考才能写入 `approvedReferences`，并设 `approvedByUser: true`。代码存在后才能标记 `implemented`。只有多模态 Agent 已检查原稿和实际截图、相关业务测试通过时，才能标记 `validated`，且必须同时写入非空 `visualEvidence` 和 `businessEvidence`。

每次更新外部 `stateFile` 后重新校验。状态只保存相对于 `evidenceDirectory` 的证据路径、测试名和非敏感结果；禁止密码、Token、Cookie、Authorization、session 和 signed URL。

## 旧仓库状态

旧项目存在 `.design-context/migration.json` 时使用：

```bash
design-context migration import "$TARGET_DIR" --from-repository --json
```

CLI 先校验旧状态，再复制到外部 workspace；不会删除旧目录。外部状态缺失时，`init`/`validate` 也会执行同一兼容导入并返回 cleanup diagnostic。新旧状态同时存在且内容不同会以 conflict 停止，不覆盖或合并任何一方。旧 packages/evidence 可以定向读取用于一次性迁移，但所有后续写入必须使用外部 `packagesDirectory` 和 `evidenceDirectory`。

Agent 不得自动删除旧 `.design-context`，不得自动修改目标项目的 `.gitignore`；只提示用户自行确认清理。
