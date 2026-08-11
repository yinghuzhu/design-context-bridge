---
name: design-replicate
description: 使用设计平台 URL 在新项目中创建页面，或按用户明确指定的目标、已完成新版参考和业务保护边界迁移已有前端页面；当用户显式调用 $design-replicate，或要求多模态视觉复刻、对照设计截图还原、继续既有设计迁移时使用。
---

# Design Replicate

## Hard gate

1. 确认当前 Agent 能用多模态能力查看本地图片；否则只能准备上下文包，不得宣称视觉复刻完成。
2. 要求可信输入明确 `target repository`、`target page/route` 和 `design-platform URL`。迁移还必须明确 `approved reference`（首次迁移可以明确为空）和 `protected business behavior`。
3. 任一必填输入缺失时停止仓库分析和修改，按 [input contract](references/input-contract.md) 向用户补齐。
4. 输入完整后先执行 `design-context workspace resolve "$TARGET_DIR" --json`，只从返回的外部 workspace 恢复 migration state；此时不读取目标仓库实现。
5. 设计来源范围门禁通过后，再读取适用的 `AGENTS.md`、`CLAUDE.md` 和用户指定说明，然后才能分析或修改目标实现。

## Workflow

1. 先解析外部 workspace，再按 [context package](references/context-package.md) 使用 `design-context prepare "$DESIGN_URL" --target "$TARGET_DIR" --json` 并独立校验包。
2. 除适用的项目说明外，在读取或修改目标仓库前，查看 manifest screenshot 并与用户描述的目标范围对照。遇到 `design_scope_suspicious` 或截图明显缺少目标主要元素时停止该目标；批量任务只阻塞当前 unit，其他独立 unit 可以继续。
3. 按 [migration modes](references/migration.md) 从外部 state directory 选择新建、首次迁移、持续迁移或接管迁移。
4. 只读取目标、已批准参考、受保护业务及其必要直接依赖；不得扫描整个仓库猜测新旧页面。
5. 沿用目标仓库技术栈，复用已批准组件和素材，保持 API、路由、状态、校验、错误处理和数据流不变。
6. 按 [browser and auth](references/browser-auth.md) 启动真实应用并取得目标页面截图；当前浏览器不可用时可使用外部 Playwright MCP 独立浏览器。截图和临时证据写入 workspace 的 `evidenceDirectory`。
7. 按 [validation](references/validation.md) 由多模态 Agent 查看原稿截图和真实页面截图，记录差异、定向修改并重新截图。
8. 修改可能影响交互或已有业务流程时必须验证；视觉通过但业务失败时不得通知人工验收。
9. 只有工具视觉门禁、构建、交互及受保护业务检查都通过后，才更新 CLI 返回的外部 `stateFile` 并重新校验。
10. 准备提交前执行 `git diff --cached --name-only`；发现任何生成物已暂存时停止提交并提示用户清理。不得执行 `git add -A`。

## Source priority

依次使用 manifest 声明的 screenshot 作为视觉真值、`design.json` 获取规范化几何/文字/样式/组件关系、`assets/` 获取媒体，再用 `AI_CONTEXT.md`、`styles.json` 和 `components.json` 有界导航。辅助 renderer 不是实现来源或视觉通过证据。

## Examples

- 新页面：[new page](examples/new-page.md)
- 首次迁移：[initial migration](examples/initial-migration.md)
- 持续迁移：[continuation](examples/continuation.md)
- 接管已有迁移：[adoption](examples/adoption.md)

## Prohibitions

- 不把未经用户、项目说明或有效状态批准的页面指定为新版参考。
- 不得默认创建或修改目标项目的 `.design-context`，不得自动修改目标项目的 `.gitignore`。
- 不得因为跨会话恢复而把 package、截图、原始 JSON、资产或证据写进业务仓库。
- 用户明确要求工程内存储时，先说明误提交风险；只有命令同时带 `--allow-in-repo` 才允许。
- 未同时查看原稿和真实运行页面截图时，不宣称视觉通过。
- 不得把 `design_scope_suspicious` 当作可忽略的下载警告，也不得静默改用父节点或兄弟节点。
- CLI 不做图片识别、视觉评分或最终视觉结论。
- 不输出或持久化密码、Token、Cookie、Authorization header、session 或 signed URL。
- 不自建 MCP/HTTP 服务；浏览器不足时使用外部 Playwright MCP。
