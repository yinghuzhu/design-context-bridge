# 设计来源范围门禁设计

## 背景

Figma URL 可能指向画布中视觉目标的一个底层图形，而不是包含全部内容的 Frame、Group、Section 或 Component。例如节点 `891:1524` 实际是一个 500×650 的白色 `RECTANGLE`，标题、输入框、按钮和协议文字是与它重叠的兄弟节点。Figma API 正确导出该矩形后，现有 package 仍会因为文件齐全而标记为 `complete`，Agent 随后可能把选择范围错误误认为空白设计。

## 目标

- 用确定性结构检查识别明显低信息的设计根节点，不在 CLI 中引入图片识别。
- 新下载和旧缓存都返回一致诊断。
- 多模态 Agent 在读取或修改目标仓库前确认原稿截图与用户描述的目标范围一致。
- 只阻塞引用错误设计来源的目标；批量任务中的其他独立目标仍可继续。
- 不静默扩大到父节点或兄弟节点，避免把无关画布内容纳入实现范围。

## Core/CLI 设计

新增 provider-neutral 的 `diagnoseDesignScope(document)`。当根节点同时满足以下条件时返回一个诊断：

- 类型是基础图形：`RECTANGLE`、`ELLIPSE`、`LINE`、`POLYGON` 或 `STAR`；`SLICE` 是明确的导出区域，不按基础图形处理；
- 没有子节点；
- 没有文字；
- 没有可导出资产引用。

诊断契约：

```json
{
  "code": "design_scope_suspicious",
  "message": "Selected design root 891:1524 is a leaf RECTANGLE with no child nodes, text, or exportable assets. Select a containing frame, group, section, or component, or explicitly confirm that a primitive-only design is intended.",
  "retryable": false,
  "nodeId": "891:1524"
}
```

新 package 在写 manifest 前加入该诊断并将状态设为 `partial`。`validate-package` 必须根据 `design.json` 重新计算该诊断，使旧缓存不能绕过新门禁；manifest 已包含相同诊断时去重。根节点本身是图片、矢量、Component 或 Instance 时不触发，避免阻止合法素材或组件来源。

`--refresh` 不会改变同一错误节点的选择范围，因此诊断为不可重试。CLI 仍保存外部 package，便于 Agent 展示节点 ID、类型和截图，不修改目标业务仓库。

## Skill 设计

Skill 在 prepare、validate 和 inspect 之后，读取目标仓库之前执行来源范围门禁：

1. 遇到 `design_scope_suspicious` 时，不得把该 unit 交给实现阶段。
2. 多模态 Agent 查看 manifest screenshot，并与用户自然语言中的系统目标、目标类型和视觉范围对照。
3. 截图为空白、近乎单色或缺少用户描述的主要元素时，停止该 unit，报告实际节点 ID、类型及内容摘要。
4. 提示用户在 Figma 图层面板选择包含全部内容的外层 Frame、Group、Section 或 Component，再复制“所选内容的链接”。
5. Agent 能操作 Figma 时可以有界检查父级候选，但设计 URL 或 node ID 发生变化时必须纳入执行契约确认，禁止静默替换。
6. 用户明确需要基础图形本身且目标类型允许时，可以记录显式确认后继续；不得把一般页面、弹窗、Tab、表单、Section 或 Flow 当作这种例外。

批量任务中，该诊断只阻塞引用对应 package 的 unit；其他独立 unit 按原流程继续。

## 验证

- 新 prepare 对叶子白色矩形产生一次不可重试诊断并返回 `partial`。
- 旧 manifest 即使写着 `complete`，重新 validate 后仍返回 `partial`。
- 带 IMAGE/VECTOR 资产引用的叶子根节点保持 `complete`。
- Skill 契约要求在仓库读取和修改之前完成截图与目标描述匹配。
- Forward eval 证明 Agent 不扫描或修改目标仓库、不尝试 refresh、不宣称复刻完成，并给出可操作的重新选区提示。
