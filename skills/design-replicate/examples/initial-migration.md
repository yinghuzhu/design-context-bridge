# Initial migration

## User prompt

迁移 `/orders`；用户明确 approvedReferences 为 `[]`，订单 API、筛选与分页不可改变。

## Accepted mapping

模式 `initial`；旧 `/orders` 是 `legacy_behavior_source`，不是视觉参考。

## Allowed files

目标 route、页面、直接组件、订单 API/store/tests。

## Forbidden scope expansion

不寻找“看起来较新”的其他页面。

## State changes

初始化外部 `stateFile`，保留 approvedReferences `[]`，逐步把证据写入外部 `evidenceDirectory`。

## Evidence

原稿/实际截图多模态比较；筛选、分页和 API 契约测试。

## Expected final report

工具门禁通过后报告视觉与业务证据，再请求人工验收。
