# 迁移模式与跨会话状态

## 会话恢复

先读取适用说明和 `.design-context/migration.json`，再执行：

```bash
design-context migration validate "$TARGET_DIR" --json
```

只有 schema v1 校验通过的状态能作为事实来源。新会话不等于新迁移；继续使用已批准参考、保护边界和验证证据，但当前目标及 design-platform URL 仍必须由用户或可信说明明确。

## 模式

- `new`：创建非迁移页面；仍需明确目标和设计 URL。
- `initial`：已有旧业务页但没有获批准的新版实现；approved references 必须明确为空。
- `continuation`：仓库已有有效状态；核实本次目标涉及的记录与当前代码，不扩大扫描。
- `adoption`：使用本工具前已经迁移部分页面但没有有效状态；用户必须点名可作为新版参考的页面。

不得扫描仓库自动判定模式、新旧页面或参考页面。来源冲突时由用户裁决。

## Schema v1 与事实演进

状态文件是 `.design-context/migration.json`，包含 `schemaVersion`、`targets`、`approvedReferences`、`legacyBehaviorSources`、`protected`、`validations`。首次创建：

```bash
design-context migration init "$TARGET_DIR" --json
design-context migration validate "$TARGET_DIR" --json
```

只有用户或适用说明确认的参考才能写入 `approvedReferences`，并设 `approvedByUser: true`。代码存在后才能标记 `implemented`。只有多模态 Agent 已检查原稿和实际截图、相关业务测试通过时，才能标记 `validated`，且必须同时写入非空 `visualEvidence` 和 `businessEvidence`。

每次更新后重新校验。状态只保存相对证据路径、测试名和非敏感结果；禁止密码、Token、Cookie、Authorization、session 和 signed URL。

## 仓库保存策略

- `.design-context/migration.json` 只记录已确认的非敏感事实，经目标项目审查后可以提交。
- `.design-context/packages/` 是设计截图、结构和素材缓存，默认加入目标项目 `.gitignore`，不得自行提交。
- `.design-context/evidence/` 是本地或 CI 验证证据，默认忽略；只有目标项目明确批准后才能提交。

可以参考工具仓库的 `templates/design-context.gitignore`。不得因为需要跨会话恢复，就把设计资产、凭据或未批准截图提交到目标仓库。
