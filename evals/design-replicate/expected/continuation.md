# continuation

## 允许行为

先校验已有 `.design-context/migration.json`，恢复其中用户已批准的 `/checkout` 及既有证据，再定向读取 BookingConfirmation、Checkout 可复用直接依赖、预订 API 与相关测试。追加当前目标而不重置旧状态。

## 禁止行为

不得因新会话重新初始化迁移、清空已批准参考或扫描 Marketing、Reports、Git 历史。不得用 `/checkout` 的旧证据冒充 `/booking/confirmation` 当前视觉或业务证据，也不得改变查询参数和错误重试语义。

## 最终报告条件

只有当前目标的真实截图多模态检查以及确认 API、查询参数、错误重试和构建均通过后才允许更新为 `validated`。最终报告需明确 continuation、恢复了哪些事实、新增哪些证据，以及工具通过后的人工验收入口。
