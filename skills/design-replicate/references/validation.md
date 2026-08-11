# 多模态视觉、业务与提交验证

CLI 不做图片识别、视觉评分或通过结论。多模态 Agent 必须同时查看 manifest 指向的原稿截图和真实启动应用的实际截图。实际截图、差异记录和临时证据全部写入 workspace 的外部 `evidenceDirectory`。

## 来源范围门禁

除适用的项目说明外，必须在读取或修改目标仓库前查看原稿截图，并把它与用户描述的系统目标、目标类型、激活方式和视觉范围对照。`design_scope_suspicious` 是不可重试的阻塞诊断；即使 CLI 没有产生该诊断，只要截图为空白、近乎单色或缺少用户描述的主要元素，也不得进入实现阶段。

报告实际 node ID、节点类型和缺失内容，提示用户重新选择包含完整设计的外层容器。不得静默选择父节点、兄弟节点或整张画布，也不得用 renderer 猜测缺失内容。用户明确确认目标就是基础图形时可以记录例外；一般页面、弹窗、Drawer、Tab、表单、Section 或 Flow 不适用该默认例外。

批量任务只阻塞引用该设计来源的当前 unit，其他来源完整且依赖不受影响的 unit 可以继续。阻塞 unit 不得写 implemented、validated 或通知人工验收。

## 可比证据

两张图保持同一 viewport、device pixel ratio、响应式断点、页面状态、locale 与稳定内容数据。实际截图必须来自目标 route，不能是登录页、错误页、loading、renderer 或测试替身。

## 检查维度

检查结构、几何、对齐、间距、字体、字号、字重、行高、换行、颜色、边框、圆角、效果、层级、素材、object-fit、裁剪，以及设计要求的 hover/focus/disabled/loading/empty/error/success 状态。

每个差异记录 `area`、`severity`、`expected`、`actual`、`likely cause`、`evidence path`。定向修改并重新截图，直到没有未解决的高、中优先级问题；低优先级差异必须在报告中列出。

## 业务门禁

运行目标项目要求的 build、typecheck、lint、单元/组件测试和必要浏览器检查。修改可能影响交互或已有业务流程时必须验证相关 interaction、API、state、validation、error handling 和 protected flow。

视觉通过但业务失败时保持 blocked，不写 validated，不通知人工验收。只有视觉门禁和业务门禁都通过后，记录 `visualEvidence`、`businessEvidence`，校验迁移状态，再通知人工验收。

## 提交污染门禁

Skill 不得执行 `git add -A`。准备提交前必须运行：

```bash
git diff --cached --name-only
```

检查暂存路径是否包含 `.design-context/`、`playwright-report/`、`test-results/`、`coverage/`，以及 Skill 生成的截图、原始 JSON、导出资产或临时证据目录。还应检查 `git status --porcelain`，确认本次运行没有在目标仓库生成这些文件。发现生成物已 staged 时必须停止提交并提示清理，不得自动提交、自动改 `.gitignore` 或把生成物伪装成业务资产。
