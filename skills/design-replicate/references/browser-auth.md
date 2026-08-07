# 浏览器、登录与真实截图

## 浏览器路径优先级

按顺序选择第一条可用路径：

1. 当前 Agent 可控制的浏览器或现有授权会话。
2. 外部 Playwright MCP 独立浏览器；提前说明其登录态通常独立。
3. 目标项目已有 Playwright、Cypress 或等效真实浏览器测试。

不得用 renderer、DOM 快照或静态组件预览冒充真实运行目标页截图。记录运行 URL、viewport、device pixel ratio、页面状态、数据条件和截图路径。

## 登录

先复用有效 session，再定向读取适用 `AGENTS.md`、`CLAUDE.md`、README、测试说明及其直接引用的 storage state、测试账号说明、seed、登录 script 或环境变量名。在已授权 local/development/test 环境按项目文档自动登录。

只有遇到 MFA、短信/邮件验证码、CAPTCHA、企业 SSO、缺少授权或必须选择身份时才请用户在所选浏览器接管；接管后继续自动验证。

不得索要用户在聊天中发送密码、Token、Cookie、Authorization、验证码或 session 内容；不得回显、截图或持久化凭据。生产环境登录、导航或截图必须另有明确授权。
