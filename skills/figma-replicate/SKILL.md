---
name: figma-replicate
description: 使用 Figma URL 在新项目中创建页面，或按用户明确指定的目标、已完成新版参考和业务保护边界迁移已有前端页面；当用户显式调用 $figma-replicate，或要求多模态视觉复刻、对照截图还原、继续既有 Figma 迁移时使用。
---

# Figma Replicate

## Hard gate

1. 确认当前 Agent 能用多模态能力查看本地图片。否则停止完整复刻，只允许准备设计上下文资产包，且不得宣称视觉验收通过。
2. 先读取适用的 `AGENTS.md`、`CLAUDE.md`、`.figma-context/migration.json` 和用户直接指定的项目说明。
3. 要求用户或上述可信说明明确目标仓库或目录、目标页面或路由及其 Figma URL。迁移时还必须明确新版参考（首次迁移可明确为无）和受保护业务行为。任何一项缺失时，先向用户询问，不得开始仓库分析或修改。
4. 读取 `references/input-contract.md`，严格执行有界分析规则。

## Workflow

1. 读取 `references/context-package.md`，调用 `figma-context` 准备并校验资产包。
2. 读取 `references/migration.md`，选择新建、首次迁移、持续迁移或接管迁移模式。
3. 只检查目标、已批准参考以及完成当前工作所需的直接依赖。
4. 保持已确认的 API、路由、状态、校验、错误处理和业务边界不变。
5. 沿用目标仓库技术栈；仅在用户明确指定时选择其他技术栈。
6. 读取 `references/browser-auth.md`，通过可用浏览器路径获取真实目标页面截图。
7. 读取 `references/validation.md`，由多模态 Agent 对比原稿截图与实际截图并迭代修正。CLI 不负责视觉判断。
8. 修改可能影响交互或已有业务流程时，运行相应交互和业务验证。
9. 只把用户确认或工具验证的事实写入 `.figma-context/`。
10. 完成视觉、构建、交互和受保护业务检查，且工具验证通过后才通知人工验收。

## Source priority

依次使用 `manifest.json` 声明的 screenshot 路径（通常是 `screenshot.png`）作为视觉真值、`node.json` 获取精确几何和文字、`assets/` 获取原始媒体、`AI_CONTEXT.md` 导航相关信息。仅把 `reconstruct.html` 作为辅助参考，不把它当作业务实现来源。

## Prohibitions

- 禁止扫描整个仓库来猜测新旧页面；不得遍历无关页面、完整组件库或全部 Git 历史。
- 禁止把未经用户、项目说明或 `.figma-context/` 批准的页面指定为新版参考。
- 未同时查看原稿截图和真实运行页面截图时，不得宣称视觉验收通过。
- CLI 不负责图片识别、视觉差异评分或最终视觉结论。
- 不得输出凭据，也不得把密码、Token、Cookie 或 Authorization header 写入 `.figma-context/`。
- 不为本项目声明或实现自建 MCP 或 HTTP 服务；需要独立浏览器时可使用外部 Playwright MCP。
