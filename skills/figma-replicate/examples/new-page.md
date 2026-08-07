# New page example

## User prompt

> 在当前 React 项目新建 `/offers/summer` 页面，对应 Figma URL 是 `https://www.figma.com/design/example/Offers?node-id=500-600`；页面文件放在现有 offers 功能目录，保持现有全局导航与登录跳转，目标桌面 viewport 为 1440×900。没有旧页面，也没有额外新版参考。

## Accepted mapping

- 模式：`new`，目标仓库、目标路由 `/offers/summer`、Figma URL 和现有 React 技术栈都已明确。
- `target`：新页面路由、实现文件和其必要直接组件。
- `approved_reference`：无；不因新建页面搜索或推断其他新版页面。
- `legacy_behavior_source`：无旧目标页；只定向读取现有路由接入方式。
- `protected`：现有全局导航和登录失效跳转。

## Allowed files

- `/offers/summer` 对应的最小路由配置、新页面和直接组件。
- 页面直接使用的现有共享布局、样式接口和 Figma 资产包素材。
- 全局导航与登录跳转的直接集成点和相关测试；只读到足以保持既有语义为止。

## Forbidden scope expansion

- 不遍历全部 offers 页面、完整组件库或 Git 历史来寻找视觉参考。
- 不把未获批准的现有页面当作 `approved_reference`，不顺带重构全局导航或鉴权。
- 不用 `reconstruct.html`、CLI 图片评分或 CLI 图片识别代替真实页面和 Agent 视觉判断。

## State changes

1. 实现开始时只记录已确认的目标、Figma 来源和 `in_progress`；不记录任何凭据。
2. 路由和代码真实存在后才能记录 `implemented`。
3. 只有多模态视觉证据以及导航、登录跳转等业务证据都通过后，才能记录 `validated`；视觉通过但业务失败时保持 `in_progress` 或 `blocked`。

## Evidence

- 原稿：manifest 声明的 Figma 原稿截图，记录目标 viewport 1440×900 和设计状态。
- 实际：从真实启动的 React 应用访问 `/offers/summer`，在相同 viewport、device pixel ratio、内容数据和页面状态下取得实际截图，并记录运行 URL。
- 视觉：由多模态 Agent 同时查看原稿截图和实际截图，按结构、几何、间距、排版、颜色、层级、素材、裁剪和要求状态记录差异；不使用 CLI 图片识别或评分。
- 工程与业务：记录 build、type、console、交互、导航和登录失效跳转检查；存在 high/medium 视觉问题或任何相关业务失败时继续修复或报告阻塞。

## Expected final report

报告 `new` 模式、目标路由和 Figma URL、修改文件、真实运行 URL、原稿/实际截图路径、viewport/DPR/状态/数据、多模态检查结果、构建与业务检查，以及全部低优先级差异。只有没有 high/medium 视觉问题且导航和登录跳转验证通过后，才通知“工具检查已通过，请人工验收”；视觉通过但业务失败时不得发送该通知。
