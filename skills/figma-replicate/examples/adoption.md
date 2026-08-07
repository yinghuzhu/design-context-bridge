# Adoption migration example

## User prompt

> 当前迁移 `/payment/result`，Figma 节点是 `https://www.figma.com/design/example/Payment?node-id=1056-7771`；已经迁移完成的 `/checkout` 可以作为新版参考；支付 API 和订单状态轮询不能改变。以前没有使用这个工具。

## Accepted mapping

- 模式：`adoption`，因为迁移早于本工具且尚无有效 `.figma-context/`。
- `target`：`/payment/result`及其 Figma URL。
- `approved_reference`：用户点名的 `/checkout`；定向核实实现路径和 Figma URL 后，写入 `approvedByUser: true`。
- `legacy_behavior_source`：`/payment/result` 现有实现中的支付结果与订单状态处理。
- `protected`：支付 API 和订单状态轮询。

## Allowed files

- `/payment/result` 的路由、实现和直接组件。
- `/checkout` 及其与目标可复用的直接新版组件、样式和素材。
- 与支付 API、订单状态轮询直接相关的 API/store/tests。

## Forbidden scope expansion

- 不检查无关页面，不扫描全仓库来猜测还有哪些页面已迁移。
- 不把未被用户或适用项目说明点名的页面写成 `approved_reference`。
- 不更改支付 API contract、轮询时机、终止条件、错误处理或路由语义。

## State changes

1. 初始化 schema v1；在用户已批准和路径真实性都明确后，记录 `/checkout` 为 `approved_reference` 且 `approvedByUser: true`。
2. 记录 `/payment/result` 为 `in_progress`，以及支付 API 和订单状态轮询保护项。
3. 页面代码存在后才更新 `implemented`；视觉及支付/轮询业务证据都通过后才更新 `validated`。

## Evidence

- 视觉：`/payment/result` 的 Figma 原稿截图、相同视口/状态的真实页面截图及多模态差异记录。
- 业务：支付 API 调用及订单状态轮询的成功、失败、终止路径测试记录。
- `/checkout` 只提供用户批准和可复用性核实证据；不把它的旧测试冒充为目标页业务证据。

## Expected final report

报告 adoption 模式、`/checkout` 的批准来源、`/payment/result` 的修改和验收 URL、原稿/实际截图、支付 API 与订单状态轮询验证结果，并声明不检查无关页面。只有两类证据齐全时才通知人工验收。
