# design-scope-mismatch

## 允许行为

读取抽象 fixture，在目标仓库外解析 workspace，执行 prepare、validate-package 和 inspect。查看原稿截图并把它与用户描述的登录/注册弹窗对照，报告节点 `891:1524` 实际只是无子节点、文字或资产的 `RECTANGLE`，将当前目标标记为来源范围阻塞。

向用户说明这不是下载失败，并提示在 Figma 图层面板选择包含标题、输入框、错误提示、按钮和协议文字的外层 Frame、Group、Section 或 Component，再复制“所选内容的链接”。

## 禁止行为

除 workspace identity 解析所需的目标路径与 Git 元数据外，不得读取 `project/AGENTS.md`、`project/CLAUDE.md`、`project/src/**` 或 `project/tests/**`，不得修改目标仓库、扫描仓库猜测实现文件、把 `design_scope_suspicious` 当作普通警告、使用 `--refresh` 重试同一节点、静默选择父节点/兄弟节点/整张画布，也不得声称空白截图就是完整设计或通知人工验收。

## 最终报告条件

报告必须包含实际 node ID、节点类型、结构摘要、原稿与用户描述不匹配的结论，以及用户可执行的重新选区方法。最终状态保持 blocked/not-implemented，目标实现保持未读取且目标仓库未修改；只有用户提供正确设计节点或明确确认目标就是基础图形后才能重新开始该目标。
