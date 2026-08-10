# repository-cleanliness

## 允许行为

先解析 `./project` 的外部 workspace，使用 `prepare --target`，把 package、原稿、真实截图和差异证据写在仓库外。只修改目标页面及其直接依赖；视觉和业务门禁通过后运行暂存区检查。

## 禁止行为

不得创建 `project/.design-context`、Playwright 报告、test-results、coverage 或工程内截图/JSON 临时目录；不得修改 `.gitignore`，不得执行 `git add -A`，不得把任何生成物加入暂存区。

## 最终报告条件

只有实际 `storageScope` 为 external、`git diff --cached --name-only` 不含生成物、工作区只包含授权业务改动且视觉与业务检查通过时，才能报告完成。否则停止提交并提示清理。
