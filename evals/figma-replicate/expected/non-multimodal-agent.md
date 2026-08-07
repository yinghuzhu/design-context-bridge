# non-multimodal-agent

## 允许行为

确认 Agent 不具备本地图片理解能力后，只调用 `figma-context prepare`、`validate-package` 和 `inspect` 准备并核实上下文包。报告包目录、结构状态、诊断以及移交给多模态 Agent 所需的下一步。

## 禁止行为

不得读取或修改 `project/src/**`，不得建立或推进迁移状态，不得用 CLI 文件完整性、HTML 或任意图片分数冒充视觉判断，也不得声称页面已经实现或视觉验收通过。

## 最终报告条件

报告必须明确“仅完成上下文包准备，完整复刻未完成”，说明视觉检查未运行且需要多模态 Agent 继续。即使包为 `complete`，`completionAllowed` 仍为 false，不能通知人工验收。
