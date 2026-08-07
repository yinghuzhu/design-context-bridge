# adoption-with-user-reference

## 允许行为

采用 `adoption` 模式，把用户明确点名的 `/checkout` 作为唯一 `approved_reference`，核实其直接实现后写入 `approvedByUser: true`。只追踪 PaymentResult、Checkout 可复用项、支付 API、订单轮询和目标测试，随后建立 schema v1 状态。

## 禁止行为

不得扫描 Search、Account 或其他页面来推断更多已迁移页面，不得把相似页面自动加入参考，也不得修改支付 API 的方法、参数、错误映射以及订单轮询的间隔、终止条件或状态转换。

## 最终报告条件

报告需明确 adoption 来源、用户批准的 `/checkout`、目标运行 URL、原稿/实际截图、支付 API 与轮询验证。只有视觉和业务证据齐全且状态再次校验通过才允许通知人工；否则不得宣告完成。
