# Continuation migration example

## User prompt

> 继续迁移 `/booking/confirmation`，Figma 节点是 `https://www.figma.com/design/example/Booking?node-id=300-400`。`.figma-context/` 里已确认的 `/checkout` 可作为新版参考。保留预订确认 API、查询参数和错误重试。

## Accepted mapping

- 模式：`continuation`，前提是现有 `.figma-context/migration.json` 的 schema v1 校验通过。
- `target`：`/booking/confirmation`。
- `approved_reference`：状态中已存在且代码路径真实的 `/checkout`，其 `approvedByUser` 为 `true`。
- `legacy_behavior_source`：目标旧页的确认 API、查询参数和错误重试实现。
- `protected`：预订确认 API、查询参数、错误重试。

## Allowed files

- `/booking/confirmation` 路由、页面及其直接依赖。
- `/checkout` 页面和可复用的直接新版组件、样式、素材。
- 直接相关的预订确认 API/store/validation/tests。

## Forbidden scope expansion

- 不因为换了新会话而重置迁移状态或从头分析整个仓库。
- 不读取状态未批准的其他已迁移页面来扩大视觉规范。
- 不修改无关预订流程、API 或路由。

## State changes

1. 先校验并保留现有已批准参考和证据，追加 `/booking/confirmation` 为 `in_progress`。
2. 代码完成后才写 `implemented`；视觉或业务检查未通过则保持 `in_progress` 或 `blocked`。
3. 仅当 `visualEvidence` 和 `businessEvidence` 均非空时写 `validated`，然后重新运行 migration validate。

## Evidence

- 视觉：Figma 原稿、真实 `/booking/confirmation` 运行截图及差异闭环记录。
- 业务：确认 API 请求、查询参数保留和错误重试测试结果。

## Expected final report

报告 continuation 模式、恢复的已批准事实、本次修改、验收 URL、截图与全部检查；明确本次没有重置旧状态，并只在工具门禁通过后通知人工验收。
