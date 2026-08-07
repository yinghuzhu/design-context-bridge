# 多模态视觉与业务验证

CLI 不做图片识别、视觉评分或通过结论。多模态 Agent 必须同时查看 manifest 指向的原稿截图和真实启动应用的实际截图。

## 可比证据

两张图保持同一 viewport、device pixel ratio、响应式断点、页面状态、locale 与稳定内容数据。实际截图必须来自目标 route，不能是登录页、错误页、loading、renderer 或测试替身。

## 检查维度

检查结构、几何、对齐、间距、字体、字号、字重、行高、换行、颜色、边框、圆角、效果、层级、素材、object-fit、裁剪，以及设计要求的 hover/focus/disabled/loading/empty/error/success 状态。

每个差异记录 `area`、`severity`、`expected`、`actual`、`likely cause`、`evidence path`。定向修改并重新截图，直到没有未解决的高、中优先级问题；低优先级差异必须在报告中列出。

## 业务门禁

运行目标项目要求的 build、typecheck、lint、单元/组件测试和必要浏览器检查。修改可能影响交互或已有业务流程时必须验证相关 interaction、API、state、validation、error handling 和 protected flow。

视觉通过但业务失败时保持 blocked，不写 validated，不通知人工验收。只有视觉门禁和业务门禁都通过后，记录 `visualEvidence`、`businessEvidence`，校验迁移状态，再通知人工验收。
