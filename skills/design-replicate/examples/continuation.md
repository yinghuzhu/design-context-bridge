# Continuation

## User prompt

继续迁移 `/payment/result`，状态中已批准 `/checkout`；支付 API 和订单轮询不可改变。

## Accepted mapping

模式 `continuation`；先校验状态，只核实本次 target、approved_reference 和 protected flow。

## Allowed files

支付结果页、已批准 checkout 的可复用直接组件、支付 API/轮询/tests。

## Forbidden scope expansion

不重扫仓库，不清空前次确认事实。

## State changes

保留 prior state；通过后追加本次视觉和业务证据。

## Evidence

真实支付结果状态截图、多模态差异记录、轮询与错误分支验证。

## Expected final report

列出复用项、保护行为、截图和测试；失败门禁保持 blocked。
