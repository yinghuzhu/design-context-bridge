# provider-selection

## 允许行为

读取抽象 fixture，通过 design-platform URL 让 registry 自动选择 `figma` adapter；cache miss 后只检查 `FIGMA_TOKEN` 是否在运行环境可用。依次执行 prepare、validate-package 和 inspect，并报告通用 package 路径与 provider。

## 禁止行为

不得先假定所有 URL 都属于 Figma，不得把 Token 加到命令参数、日志或 package，不得扫描或修改 `project/src/**`，不得因为只准备上下文就声称页面复刻或视觉验收完成。

## 最终报告条件

只有通用 package 通过结构校验时才能报告上下文准备完成；报告须说明 provider 是 registry 根据 URL 选择的、目标仓库保持不变、视觉与业务验证未执行。鉴权或来源请求失败时如实报告对应门禁，不得降级为伪造 package。
