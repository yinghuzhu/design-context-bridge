# 迁移模式与跨会话状态

本文档只负责选择工作模式和维护已确认事实。不得自动判定新旧页面，包括通过扫描页面、文件名、提交时间或样式相似度猜测。

## 每个新会话的恢复顺序

1. 读取适用的 `AGENTS.md`、`CLAUDE.md`、README、用户直接指定的项目说明。
2. 检查目标仓库是否存在 `.figma-context/migration.json`。存在时先执行 `figma-context migration validate "$TARGET_DIR" --json`；只有 schema v1 校验通过的状态才能作为输入。
3. 对照当前真实代码核实状态中本次目标和已批准参考的实现路径，但不借此扩大扫描范围。
4. 要求当前目标页面或路由及其 Figma URL。迁移任务还要求明确的新版参考和受保护业务行为；`initial` 的新版参考必须明确为空。
5. 用户、项目说明与现有状态发生冲突时，停止实施并由用户裁决；不得自行选择更“像新版”的页面。

**新会话不等于新迁移**。重启 Codex、Claude Code 或更换 Agent 后，仍应从已校验状态和当前代码继续，不能清空已批准参考、保护边界或验证证据。

## 模式路由

- `new`：创建非迁移的新页面，没有需要继承的旧目标实现。仍须明确目标、Figma URL 和仓库范围；不因“新建”扫描整个仓库。
- `initial`：目标是已有旧业务页面，但项目尚无任何被批准的新版实现。`approvedReferences` 必须由用户或适用项目说明明确确认为 `[]`，Agent 不得自选一个参考页面。
- `continuation`：目标仓库已有通过 `figma-context migration validate` 的 `.figma-context/migration.json`。从其记录的已批准事实、受保护行为和当前真实代码继续；状态不合法、与代码不符或与当前输入冲突时，不能默认它有效。
- `adoption`：在使用本工具前已迁移了部分页面，但尚无有效 `.figma-context/` 状态。必须由用户或适用项目说明点名已完成的新版页面；只定向核实这些页面及必要直接依赖，然后建立初始状态。

有效状态存在不代表它自动选定本次目标。当前用户仍须指定目标和 Figma URL；状态只能提供已经确认的参考和边界。

## Schema v1 与写入规则

`.figma-context/migration.json` 必须保持 `schemaVersion: 1` 和六个顶层字段：`schemaVersion`、`targets`、`approvedReferences`、`legacyBehaviorSources`、`protected`、`validations`。初始化时使用：

```bash
figma-context migration init "$TARGET_DIR" --json
figma-context migration validate "$TARGET_DIR" --json
```

写入不得超前于事实：

1. 只有用户或明确适用的项目说明已确认新版参考时，才向 `approvedReferences` 写入 `approved_reference`，并设置 `approvedByUser: true`。该字段表示已通过规定的人工或项目指令授权，不是 Agent 的自行判断。
2. 只有目标代码已经存在并可定位时，才把该 target 的 `status` 推进为 `implemented`。代码未完成时使用 `in_progress` 或 `blocked`。
3. 只有多模态 Agent 已查看原稿与真实运行页面，且相关业务验证已通过，才能写入 `validated`。此时 target 必须同时有非空 `visualEvidence` 和 `businessEvidence`，并在 `validations` 中记录可追溯的结果。
4. Core schema v1 只对 `validated` 状态强制两类证据，没有强制所有 target `status` 的枚举集；`in_progress` / `blocked` / `implemented` 是本 Skill 的工作流约定，不得误称为 Core 已校验的枚举。
5. 每次修改后再执行 `figma-context migration validate "$TARGET_DIR" --json`；校验失败时不得把新状态作为后续事实。

状态和证据中只记录相对文件路径、测试名称、结果及非敏感来源。不得写入或持久化密码、Token、Cookie、Authorization header、会话数据或 signed asset URL。

## 事实状态演进

```text
用户/适用项目说明批准参考
  -> approved_reference (approvedByUser: true)
目标代码已存在
  -> implemented
原稿/实际截图视觉检查 + 业务检查均有通过证据
  -> validated (visualEvidence + businessEvidence)
```

某个后续阶段未通过时，保留已发生事实并写入 `in_progress` 或 `blocked`，不得伪造证据，也不得把只有截图或只有测试的目标标记为 `validated`。
