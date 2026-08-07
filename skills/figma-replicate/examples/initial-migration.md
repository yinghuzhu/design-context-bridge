# Initial migration example

## User prompt

> 首次迁移 `/account/profile`，Figma 节点是 `https://www.figma.com/design/example/Account?node-id=100-200`。目标仓库是当前项目，现在没有任何已完成的新版页面可作为参考。保留资料读写 API、表单校验和登录失效跳转。

## Accepted mapping

- `target`：`/account/profile` 和定向找到的现有实现文件。
- `approved_reference`：用户已明确为无；`approvedReferences` 接受值为 `[]`。
- `legacy_behavior_source`：目标页中现有的 API、校验和登录失效处理。
- `protected`：资料读写 API、表单校验、登录失效跳转。
- 模式：`initial`，不从仓库猜测新版参考。

## Allowed files

- `/account/profile` 的路由入口和直接页面实现。
- 目标直接使用的表单组件、样式和素材。
- 与资料读写、校验和登录失效跳转直接相关的 API/store/tests。

## Forbidden scope expansion

- 不扫描其他账户页面来选新版参考。
- 不重构全局表单库、鉴权系统或无关路由。
- 不修改已确认的 API contract、校验语义或跳转行为。

## State changes

1. 初始化 schema v1，保持 `approvedReferences: []`，将目标记为 `in_progress`。
2. 代码真实完成后才更新为 `implemented`。
3. 只在视觉和业务证据都存在时更新为 `validated`；始终不写入凭据。

## Evidence

- 视觉：manifest 声明的原稿截图、同视口和状态的真实 `/account/profile` 截图、多模态检查结果。
- 业务：资料加载/保存、校验失败和登录失效跳转的相关测试记录。

## Expected final report

报告模式、目标路由和 Figma URL；列出修改文件、真实验收 URL、原稿/实际截图、视觉与业务检查结果、剩余低优先级差异；门禁未通过时报告阻塞，不通知人工验收通过。
