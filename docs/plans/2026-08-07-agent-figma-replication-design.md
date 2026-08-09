# 多模态 Agent 驱动的 Figma 完整复刻设计方案

> Historical implementation record. 本文仅保留早期 Python/Figma 专用方案的决策过程，不是当前安装、schema 或 Skill 规范；当前规范以根目录 README、`docs/design.md` 和 `skills/design-replicate/` 为准。

> 状态：已确认
> 日期：2026-08-07
> 目标客户端：Codex、Claude Code

## 1. 背景与目标

`figma-context-bridge` 当前可以通过 Figma REST API 下载节点树、原稿截图和图片素材，并生成本地 HTML 还原页。下一阶段的目标不是让 CLI 独立生成最终业务页面，而是让它成为多模态 Coding Agent 的设计上下文基础工具。

最终用户体验为：

```text
用户提供 Figma URL、目标页面和迁移边界
  → Core/CLI 生成完整、可复用的本地设计上下文
  → Codex 或 Claude Code 按 Skill 分析并修改目标项目
  → 多模态 Agent 对比 Figma 原稿与真实运行截图并持续修正
  → 验证可能受影响的交互和既有业务流程
  → 工具验证通过后通知人工验收
```

项目忽略 Java 和 MySQL 规范；本方案仅针对 Python CLI、Agent Skill、前端项目分析和浏览器验证。

## 2. 核心设计决策

### 2.1 Core/CLI 是确定性能力主体

可以稳定执行、重复测试和跨 Agent 复用的能力放入 Python Core，并通过 CLI 暴露：

- Figma URL 解析；
- Figma API 调用；
- 节点树、原稿截图和素材下载；
- 缓存、更新和完整性校验；
- Design Token、组件关系和页面摘要提取；
- `AI_CONTEXT.md` 生成；
- 辅助 HTML 还原和并排对照页生成；
- 机器可读 JSON 输出和稳定退出码。

### 2.2 Skill 是复刻工作流与质量门禁

Skill 不复制 Core/CLI 的确定性逻辑，而是负责需要 Agent 理解和判断的工作：

- 检查强制输入是否完整；
- 判断新建或迁移模式；
- 根据目标仓库决定技术栈；
- 进行有界依赖分析；
- 识别并保护既有业务流程；
- 调用 CLI 准备设计上下文；
- 修改目标项目；
- 启动页面并获取实际截图；
- 通过多模态能力理解视觉差异；
- 反复修改直到视觉与业务验证通过；
- 生成验收材料并通知人工。

### 2.3 多模态能力是强制前提

完整复刻必须由具备图片理解能力的多模态 Coding Agent 执行。

如果 Agent 不具备图片理解能力：

- 可以单独调用 CLI 生成资产包；
- 不得进入完整复刻流程；
- 不得宣称视觉验收通过。

### 2.4 首期不建设自有 MCP 或 HTTP 服务

Codex 和 Claude Code 都能够执行本地 CLI，因此首期采用：

```text
Python Core + Agent-friendly CLI + 通用 Skill + 本地标准资产包
```

不建设 `figma-context-bridge` 自有 MCP 和 HTTP 服务。未来只有在无 Shell 环境、集中缓存、统一鉴权、审计或远程共享成为明确需求时，才增加 Core 的薄适配器。

外部 Playwright MCP 属于专业浏览器工具，可以由 Skill 调用，不代表本项目需要实现 MCP Server。

## 3. 总体架构

```text
用户输入
  ├── Figma URL
  ├── 目标页面或路由
  ├── 已确认的新版参考页面
  └── 必须保护的业务行为
          ↓
figma-replicate Skill
  ├── 强制输入检查
  ├── 模式判断
  ├── 有界仓库分析
  ├── 实施与验证循环
  └── 人工验收交接
          ↓
figma-context CLI
          ↓
Python Core
  ├── downloader
  ├── package validator
  ├── context generator
  ├── token extractor
  ├── component analyzer
  └── reference renderer
          ↓
本地设计上下文资产包
          ↓
目标项目 + 浏览器或 Playwright MCP
          ↓
多模态视觉检查 + 交互/业务验证
```

建议代码结构：

```text
figma-context-bridge/
├── src/figma_context_bridge/
│   ├── downloader/
│   ├── package/
│   ├── context/
│   ├── renderer/
│   └── validation/
├── scripts/
├── skills/
│   └── figma-replicate/
│       ├── SKILL.md
│       ├── references/
│       └── examples/
└── docs/plans/
```

## 4. CLI 设计原则

CLI 面向 Agent 和自动化环境设计，不只输出人类日志。

建议命令形态：

```bash
figma-context prepare <figma-url> --output <dir> --json
figma-context inspect <package-dir> --json
figma-context validate-package <package-dir> --json
figma-context render <package-dir> --json
figma-context status <package-dir> --json
```

所有命令必须具备：

- 稳定的参数和输出 schema；
- 明确、可记录的退出码；
- JSON 输出模式；
- 幂等执行；
- 缓存完整性校验；
- 可恢复的部分失败；
- 不向 Agent 上下文输出大型原始节点树；
- 错误信息包含恢复建议；
- 不输出 Token、Cookie 或其他凭据。

CLI 不负责图片识别、视觉相似度评分或最终视觉结论。图片理解和差异判断属于多模态 Agent。

## 5. 设计上下文资产包

每个 Figma 节点生成独立、可缓存的资产包：

```text
context-package/
├── manifest.json
├── node.json
├── screenshot.png
├── assets/
├── AI_CONTEXT.md
├── styles.json
├── components.json
├── reconstruct.html
└── compare.html
```

信息使用优先级：

1. `screenshot.png`：视觉最终真值；
2. `node.json`：尺寸、坐标、文字和节点属性的精确依据；
3. `assets/`：设计原始素材；
4. `AI_CONTEXT.md`：Agent 快速理解页面的入口；
5. `styles.json`、`components.json`：设计系统和复用辅助；
6. `reconstruct.html`：辅助观察，不作为业务实现代码来源。

资产包状态：

- `complete`：必要内容和素材完整；
- `partial`：部分非关键素材失败；
- `invalid`：节点树、原稿截图或 manifest 等关键内容缺失。

`partial` 不应直接导致整个 pipeline 停止，但缺失项必须显式报告。只有多模态视觉检查通过后才能最终交付。

## 6. 强制输入契约

### 6.1 新建模式

用户至少提供：

- Figma URL；
- 目标目录；
- 需要生成的页面或路由。

用户明确指定技术栈时必须遵循。没有指定且目标目录已有项目时沿用现有技术栈；空目录且技术栈选择会影响后续维护时，先向用户确认。

### 6.2 迁移模式

用户或项目说明必须明确：

- 本次迁移哪些页面；
- 每个页面对应的 Figma URL；
- 哪些已经完成的新页面可以作为参考；
- 哪些业务行为必须保持不变；
- 已知时提供目标路由或实现文件。

示例：

> 当前迁移 `/payment/result`，对应 Figma URL 是 `...node-id=1056-7771`；已经完成的 `/checkout` 是新版参考；支付 API、订单状态轮询、错误处理和路由行为不能改变。

`AGENTS.md`、`CLAUDE.md`、README、测试文档或 `.figma-context/` 已明确的信息视为用户预先指定，无需重复询问。

缺少目标页面、对应 Figma URL 或新版参考归属时，Skill 必须询问用户，禁止通过大范围扫描自行猜测。

## 7. 有界依赖分析

Agent 只能围绕用户定义的范围检查：

- 目标路由对应的页面文件；
- 目标页面直接引用的组件；
- 用户指定的新版参考页面；
- 参考页面使用的公共组件、样式和素材；
- 目标页面涉及的 API、Store、校验和测试；
- 为理解上述内容必须继续追踪的直接依赖。

默认禁止：

- 遍历全部页面或完整组件库；
- 搜索所有历史提交；
- 启动所有服务；
- 为整个仓库建立索引；
- 根据文件时间、名称或提交记录猜测新版页面。

分析流程：

```text
用户指定目标页面
  → 定位目标实现
  → 跟踪必要直接依赖
  → 检查指定参考页面
  → 跟踪可复用的必要依赖
  → 信息满足当前迁移后立即停止
```

## 8. 迁移模式

### 8.1 首次迁移 `initial`

已有旧业务页面，但尚未实现新版页面。Agent 需要从目标页面建立受保护业务行为清单，并为后续页面建立可复用的新组件基础。

### 8.2 持续迁移 `continuation`

项目已经使用本工具，并存在 `.figma-context/` 状态。新会话必须从状态和当前真实代码继续，不能从零重做。

### 8.3 接管已有迁移 `adoption`

项目在使用本工具前已经迁移了部分页面，但没有 `.figma-context/`。

用户必须指定哪些已完成页面是新版参考。Agent 只能基于该范围定向检查并建立初始迁移状态，不得扫描全仓库后自行判定新旧页面。

页面角色：

- `target`：本次迁移目标；
- `approved_reference`：用户或项目说明确认的新版参考；
- `legacy_behavior_source`：需要继承业务语义的旧实现；
- `protected`：本次禁止修改的文件、组件或流程；
- `unknown`：没有确认，不能作为新版参考。

复用优先级：

```text
已确认并验证的新版组件
  > 当前项目适用的共享组件
  > 已确认的新版素材
  > 当前 Figma 资产包素材
  > 新建组件或重新导出素材
```

复用前仍需验证语义和视觉适配性。

## 9. 跨会话迁移状态

目标项目使用 `.figma-context/` 保存已确认、可恢复的迁移事实：

```text
.figma-context/
├── migration.json
├── protected-behaviors.md
├── reusable-components.md
└── validations/
```

`migration.json` 使用版本化 schema，记录：

- Figma 来源和节点；
- 目标路由及实现文件；
- 用户确认的新版参考页面；
- 可复用组件和素材；
- 受保护业务行为；
- 页面状态和验证证据。

状态只能按事实推进：

- 用户确认后写入 `approved_reference`；
- 页面完成实现后写入 `implemented`；
- 多模态视觉检查和业务验证通过后写入 `validated`；
- 未完成工作记录为 `in_progress` 或 `blocked`。

状态文件不存储任何凭据。建议按目标仓库规则纳入版本控制，以支持团队和新会话复用；如果项目禁止提交设计来源信息，则至少保留在当前工作区，并明确其可迁移性限制。

新会话不等于新迁移。Skill 必须先读取项目说明和 `.figma-context/`，再要求用户指定本次目标和 Figma URL。

## 10. 浏览器和登录策略

浏览器控制不限定实现方式，只要求至少存在一种可验证路径：

1. Agent 自带浏览器控制能力；
2. Playwright MCP 独立浏览器；
3. 目标项目已有的 Playwright 或等效浏览器测试环境。

没有任何浏览器路径时，可以实施代码和执行非视觉测试，但不能宣称视觉验收完成。

登录优先级：

1. 复用当前浏览器的有效登录状态；
2. 读取 `AGENTS.md`、`CLAUDE.md`、README、测试文档和开发环境说明；
3. 使用项目提供的测试账号、登录脚本、种子数据、`storageState` 或开发免登录机制；
4. 读取项目说明引用的环境变量；
5. 自动执行普通登录流程；
6. 遇到 MFA、验证码、企业 SSO 或缺少授权信息时，请用户在浏览器中完成登录。

安全边界：

- 不在日志、报告或对话中输出密码、Token、Cookie；
- 不把凭据写入 `.figma-context/`；
- 不猜测或重置密码；
- 不为视觉验证绕过权限；
- 未明确授权生产环境时只使用本地、开发或测试环境；
- 可能触发 MFA、短信或其他外部状态变化时由用户完成。

## 11. 完整复刻工作流

### 11.1 前置检查

- 多模态能力可用；
- Figma Token 可用；
- 必要用户输入完整；
- CLI 可以执行；
- 目标目录可读写；
- 至少存在一种浏览器验证路径。

### 11.2 准备上下文

CLI 下载并校验资产包。Agent 首先查看原稿截图，再读取 `AI_CONTEXT.md`，仅在需要精确实现时查询对应节点和素材，避免把完整大型 JSON 加载到上下文。

### 11.3 定向理解目标项目

Agent 根据用户指定的目标、参考页面和保护边界进行有界依赖分析，不扩大到无关页面。

### 11.4 实施和视觉迭代

```text
修改代码
  → 构建或类型检查
  → 启动真实项目
  → 进入目标路由和状态
  → 按 Figma 对应视口截图
  → 多模态 Agent 对比原稿与实际截图
  → 输出具体差异和可能代码原因
  → 修改并重复验证
```

多模态检查覆盖：

- 页面结构；
- 位置、尺寸、间距和对齐；
- 字体、字重、行高和换行；
- 颜色、边框、阴影和层级；
- 图片、图标和裁剪；
- Hover、Focus、Disabled、Error 等要求状态；
- Figma 提供的目标响应式视口。

视觉问题清单和通过结论由多模态 Agent 产生，不由 CLI 图片算法产生。

### 11.5 交互和业务验证

凡修改可能影响既有行为，必须验证：

- 路由和参数；
- 表单输入与校验；
- 按钮、弹窗和导航；
- API 请求及响应处理；
- Loading、成功和失败状态；
- 状态管理；
- 现有相关测试；
- 用户明确保护的关键业务流程。

### 11.6 完成门禁

只有同时满足以下条件才通知人工验收：

- 所有要求页面和状态已实现；
- 多模态 Agent 没有发现未处理的高、中优先级视觉问题；
- 构建、类型检查和相关测试通过；
- 浏览器控制台没有新增错误；
- 受保护业务行为验证通过；
- 已知低优先级差异被明确记录；
- 实际截图、运行地址和验证结果可供人工复查。

## 12. 失败处理和恢复

### 12.1 输入不足

优先读取项目说明和迁移状态，仍缺少强制输入时向用户询问。不得先扫描整个仓库代替业务确认。

### 12.2 下载失败

Core 使用临时目录下载，校验成功后原子替换正式缓存。失败不能破坏已有有效资产包。

API 超时、限流和单个素材失败应提供明确分类、重试结果和恢复建议。

### 12.3 目标项目失败

迁移前尽可能记录目标页面的现有构建和测试结果。修改后区分既有问题、本次新增问题和范围外问题，不为通过测试修改无关代码。

### 12.4 浏览器或登录失败

依次尝试允许的浏览器路径和项目登录说明。需要 MFA、验证码或用户身份操作时请求用户接管。无法获得真实页面截图时，视觉验收保持未完成。

### 12.5 视觉迭代停滞

连续多轮没有实质进展时，Agent 应报告：

- 未解决问题；
- 已尝试方案；
- 判断的根因；
- 缺少的字体、素材、状态或环境；
- 需要用户协助的具体事项。

不得以“基本一致”代替完成门禁。

## 13. 测试策略

### 13.1 Core/CLI

覆盖：

- `/design/`、`/file/`、`/proto/` URL；
- 缺失或错误 Token；
- API 超时、限流和部分素材失败；
- 缓存参数和设计版本变化；
- 中断下载恢复与原子替换；
- 资产包 schema 和完整性；
- `AI_CONTEXT.md`、styles、components 输出；
- JSON 输出协议和退出码；
- 路径、文件名和私有数据保护。

大多数测试使用固定 fixture，不依赖实时 Figma API；保留可选的真实 API 冒烟测试。

### 13.2 Skill 场景

覆盖：

- 从零新建页面；
- 首次迁移；
- 读取 `.figma-context/` 持续迁移；
- 接管未使用本工具的部分迁移；
- 缺少目标页面或 Figma URL；
- 用户指定新版参考页面；
- 大型仓库下没有无界扫描；
- 自带浏览器和 Playwright MCP 两种路径；
- 按项目说明自动登录；
- MFA 或 SSO 需要用户接管；
- 非多模态 Agent 被正确阻止；
- 视觉通过但业务测试失败时不允许交付。

### 13.3 Codex 与 Claude Code

同一组任务分别验证：

- Skill 能显式和隐式触发；
- 两个客户端调用同一 CLI；
- 遵守强制输入契约；
- 只分析目标、指定参考及必要依赖；
- 新会话可以恢复迁移状态；
- 执行多模态视觉迭代；
- 工具验证通过后才通知人工。

## 14. 非目标

当前版本不实现：

- 自有 MCP Server；
- HTTP 服务；
- CLI 图片识别；
- CLI 视觉相似度评分；
- 本地视觉模型；
- 无用户范围定义的全仓库迁移分析；
- 自动猜测哪些页面属于新版设计；
- 代替人工完成最终设计验收。

## 15. 建议实施顺序

1. 将现有脚本整理成可测试的 Python Core，并保留兼容入口；
2. 定义资产包 schema、状态和原子缓存；
3. 完成 Agent-friendly CLI 与 JSON 协议；
4. 生成 `AI_CONTEXT.md`、`styles.json` 和 `components.json`；
5. 定义目标项目 `.figma-context/` schema；
6. 编写 Codex、Claude Code 通用复刻 Skill；
7. 建立新建、首次迁移、持续迁移和接管迁移测试场景；
8. 使用真实 Figma 页面分别在 Codex 和 Claude Code 中验收完整流程。
