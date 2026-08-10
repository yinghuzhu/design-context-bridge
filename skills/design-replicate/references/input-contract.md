# 输入契约与有界分析

## 开始门禁

读取目标仓库实现前，从用户、适用项目说明或 CLI 校验通过的外部 migration state 确认：

- `design-platform URL`：本次目标对应的设计节点。
- `target directory`：要修改的仓库或目录。
- `target page/route`：本次页面、路由或明确入口。
- 迁移任务的 `approved completed new references`：已完成且获批准的新版页面；`initial` 必须明确为无。
- 迁移任务的 `protected business behavior`：不得改变的 API、路由、状态、校验、错误处理、交互和业务流程；没有时也要明确为无。

适用的 `AGENTS.md`、`CLAUDE.md`、README、测试说明或用户指定文档已经写明且互不冲突时，不要求重复输入。目标目录确定后用 `design-context workspace resolve` 和 `design-context migration validate` 读取外部事实；不得通过搜索仓库中的生成目录猜测状态。输入缺失时先询问，且不得扫描或修改目标仓库。

## 范围角色

- `target`：本次目标路由与实现。
- `approved_reference`：用户或可信项目说明批准的新版参考。
- `legacy_behavior_source`：只用于继承目标原有业务语义的旧实现。
- `protected`：不得改变的接口、文件、组件或流程。
- `unknown`：来源和角色尚未确认的对象。

只有前四类能影响实现。`unknown` 必须澄清或忽略，不能成为视觉规范或复用依据。

## 允许读取

只读取用户命名的 `named routes/files`、定位入口所需的最小路由配置、目标的 `direct components`、approved refs 的可复用直接依赖，以及与目标直接相关的 `API/store/validation/tests`。允许沿直接 import 追踪一层；需要扩大目标、参考或保护范围时先确认。

## 停止规则

- 禁止默认遍历全部页面、完整组件库或全部 Git 历史。
- 禁止按文件名、时间、目录或样式相似度猜测新旧页面。
- 信息足够后立即停止扩展读取，并给出具体文件和组件映射供确认。
