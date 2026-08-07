# Adoption

## User prompt

继续迁移 `/payment/result`；项目尚无工具状态，用户指定 `/checkout` 是已完成新版参考；支付 API 和订单状态轮询不能改变。

## Accepted mapping

模式 `adoption`；`/checkout` 是 approved_reference，`/payment/result` 是 target，支付 API/轮询是 protected。

## Allowed files

只定向核实上述页面、直接复用组件、素材、API、store 和 tests。

## Forbidden scope expansion

不检查无关页面，不根据样式相似度补充参考。

## State changes

建立 `.design-context/migration.json`，参考记录 `approvedByUser: true`；验证后再推进 target。

## Evidence

原稿与实际截图的多模态检查，支付成功/失败和轮询验证。

## Expected final report

报告采用的参考映射、保护边界、证据和人工验收入口。
