# 多设计目标批次与任意 UI 落点设计

## 背景

`design-replicate` 当前以单个设计 URL 和单个目标页面为主要输入。真实使用还会出现以下情况：

- 一次任务包含多个 Figma 节点，对应系统中的多个功能；
- 同一批任务同时包含新功能和已有功能改造；
- 一个设计 frame 对应的不是独立路由，而是弹窗、抽屉、Tab、表单、页面局部或需要操作后才能出现的状态；
- 某个目标可能被设计下载、业务验证或登录阻塞，但其他目标仍应继续；
- 同一个设计可能在系统中落到多个位置，每个位置需要独立实施和验收；
- 结构化输入越来越复杂，不能要求普通使用者手写 JSON。

本设计在不改变现有 provider、单 URL package、外部 workspace 和多模态 Agent 分工的前提下，引入批次与复刻单元，并增加自然语言优先的用户输入层。

## 目标

1. 一个批次可以包含多个独立复刻目标。
2. 每个目标可以是页面或任意可定位、可触发、可验证的 UI 局部。
3. `new` 与 `refactor` 可以在同一批次混合。
4. 每个目标独立实施、阻塞、工具验证和人工验收；通过几个算几个。
5. 用户默认使用自然语言，Agent 只针对缺失或歧义信息追问。
6. CLI 继续负责确定性下载、校验、状态转换、原子写入和路径安全；视觉理解仍由多模态 Agent 完成。
7. 所有生成状态、package 和 evidence 继续默认位于目标仓库之外。

## 非目标

- 不新增 CLI 图片识别、相似度评分或视觉通过判断。
- 不新增内置浏览器、MCP 或 HTTP 服务。
- 不新增交互式 TTY wizard；Codex 和 Claude Code 本身就是对话入口。
- 不把代码层抽取出的每个公共组件都登记为复刻目标。
- 不扫描完整仓库、组件库或 Git 历史来猜测目标映射。
- 不将本功能扩展为通用项目管理或工作流引擎。

## 核心概念

### Batch

`batch` 是用户一次声明的一组改造目标，例如“个人中心改造”。它只保存稳定标识、可读名称、revision 和 units。批次执行状态由 CLI 根据 units 动态计算，不持久化容易失真的汇总状态。

### Unit

`unit` 是最小复刻和验收单元，严格表达“一份逻辑设计来源对应一个系统落点或状态”。每个 unit 独立拥有实现范围、依赖、状态、阻塞原因、视觉证据、业务证据和人工验收结果。

### Design source

`designSource` 是设计平台中的明确节点或区域，包含 provider、规范化 URL、documentId、nodeId、外部 package 相对引用和内容指纹。

### Implementation target

`implementationTarget` 是设计在系统中的实际落点，包括类型、宿主路由或运行入口、进入目标状态的操作、明确改造范围、运行时定位信息和实现文件。

支持的类型：

- `page`
- `modal`
- `drawer`
- `tab`
- `form`
- `section`
- `component`
- `flow`

### Mapping invariants

1. 一个 unit 只对应一个逻辑设计来源和一个系统落点或状态。
2. 同一设计用于两个系统位置时建立两个 unit，共享 package，但分别实施和验证。
3. 同一组件的默认、错误、移动端等不同设计状态建立独立 unit，通过 `activation` 和 `scope` 区分。
4. 一个设计 frame 含多个无关区域时，必须明确节点或区域；Agent 不自动拆分并猜测映射。
5. 代码中为复用而抽取的公共组件不自动成为 unit；只有它自身有设计来源和独立验收目标时才登记为 `component` unit。

### Approved references

Schema v2 的 approved reference 不再假设参考对象一定是 route page，分为两类：

- `unit`：指向本 workspace 中已经 `validated + accepted` 的 batch/unit，并冻结批准时的 unit revision、设计绑定和实现落点快照；
- `existing`：工具接管前已经由用户确认的实现，保存目标类型、宿主入口、scope、实现文件和可选设计来源。

每条参考有稳定 ID、名称、`active | revoked` 状态、可选撤销原因和 `approvedByUser: true`。acceptance 不自动等于“可作为参考”；用户还必须明确允许 promote。参考定义创建后不可变：同 ID、同内容的重复批准是幂等操作，同 ID、不同内容返回冲突；需要修改时必须撤销旧 ID，再由用户明确批准一个新 ID。参考被撤销或它指向的 unit reopen/rejected 时，该 unit reference 自动变为 `revoked`，所有通过 `approvedReferenceIds` 使用它的 units 都归档当前证据并标记为 `blocked`，blocker code 为 `approved_reference_revoked`。消费者保留 reference ID 以便解释历史，但不能继续验证；恢复源 unit 后也不能自动重新激活参考，仍需用户再次确认并建立新 reference ID。

## Migration Schema v2

Migration state 升级到 schema v2；package manifest 继续保持现有 schema v1。

```json
{
  "schemaVersion": 2,
  "batches": [
    {
      "id": "20260811-account-center",
      "name": "个人中心改造",
      "revision": 1,
      "units": [
        {
          "id": "orders-filter-modal",
          "name": "订单筛选弹窗",
          "revision": 1,
          "changeType": "refactor",
          "designSource": {
            "provider": "figma",
            "url": "https://www.figma.com/design/example?node-id=123-456",
            "documentId": "example",
            "nodeId": "123:456",
            "packageRef": null,
            "packageFingerprint": null
          },
          "implementationTarget": {
            "type": "modal",
            "name": "订单筛选弹窗",
            "hostRoute": "/account/orders",
            "activation": ["进入我的订单", "点击筛选按钮"],
            "scope": "只改造筛选弹窗，不改造订单列表",
            "runtimeLocator": null,
            "implementationFiles": []
          },
          "approvedReferenceIds": [],
          "legacyBehaviorSources": [],
          "protected": [],
          "dependsOn": [],
          "status": "pending",
          "blockers": [],
          "visualEvidence": [],
          "businessEvidence": [],
          "validationHistory": [],
          "acceptance": {
            "status": "pending",
            "note": null
          }
        }
      ]
    }
  ],
  "approvedReferences": []
}
```

### Identifiers and revisions

- `batch.id` 和 `unit.id` 使用稳定、可读的 slug；显示名称单独放在 `name`，改名不改变 ID。
- batch ID 在 workspace 内唯一，unit ID 在 batch 内唯一。
- 每个 batch 至少包含一个 unit；空 workspace 通过空 `batches` 表示。
- batch 和 unit revision 从 1 开始，只由 CLI 增长。
- batch 更新使用 state fingerprint 防止基于过期状态覆盖。
- unit 更新使用 unit revision 乐观锁；不同 unit 可以安全并行，同一 unit 的并发更新返回冲突。

### Unit fields

- `changeType` 只允许 `new` 或 `refactor`。
- `hostRoute` 或等价运行入口必须能让浏览器实际打开目标。
- `activation` 描述进入目标状态的操作，普通 page 可以为空。
- `scope` 必须明确改造边界。
- `runtimeLocator` 和 `implementationFiles` 可由 Agent 在有界分析后补充，不要求用户提前知道。
- 进入 `implemented` 前，所有 unit 必须有非空 implementation files；除 `page` 外的 unit 还必须有可复现的语义 runtime locator，用于跨会话重新打开和截取同一目标区域。
- `packageRef` 是相对于 workspace `packagesDirectory` 的安全路径。
- `packageFingerprint` 绑定 manifest 的 `contentFingerprint`，而不是现有的 request/cache `fingerprint`。
- `visualEvidence` 是相对于 workspace `evidenceDirectory` 的安全路径。
- `businessEvidence` 保存测试名和不含敏感数据的结果摘要。
- `approvedReferenceIds` 只引用用户批准的 workspace 级参考，避免参考规则自动扩散到整个批次。

### Security validation

Migration state 继续递归拒绝密码、Token、Cookie、Authorization、session、secret 和 signed URL。设计 URL 存储前规范化，去除与 provider/document/node 定位无关的临时查询参数。所有文件引用必须经过相对路径、真实路径和符号链接逃逸校验。

## 状态模型

### Tool execution status

```text
pending -> in_progress -> implemented -> validated
              \-> blocked -> in_progress
```

- `pending`：已登记，尚未开始。
- `in_progress`：正在分析或实施。
- `implemented`：代码已完成，但尚未通过全部门禁。
- `validated`：视觉和业务门禁均通过。
- `blocked`：当前无法继续，必须有非空 blockers。

`blocked` 恢复时必须先回到 `in_progress`，不能直接跳到 `validated`。`validated` 必须同时具有当前 package fingerprint、非空视觉证据和非空业务证据。

### Human acceptance

工具验证和人工验收使用独立状态：

- `pending`：等待人工验收。
- `accepted`：用户明确确认通过。
- `rejected`：用户发现问题；unit 回到 `in_progress` 并保留拒绝说明，重新通过工具验证时 acceptance 才重置为 `pending`。

只有人工 `accepted` 的 unit 才能通过显式 reference mutation 加入 `approvedReferences`。CLI 的接受和参考批准动作都要求 `--confirmed-by-user`，Skill 禁止在没有用户确认时调用。工具接管前的 existing reference 也必须由用户或可信项目说明明确批准。

### Batch summary

CLI 动态返回：

```json
{
  "executionStatus": "partial",
  "acceptanceStatus": "partial",
  "counts": {
    "total": 5,
    "pending": 0,
    "inProgress": 0,
    "implemented": 0,
    "validated": 3,
    "blocked": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

`executionStatus`：

- 全部 pending 为 `pending`；
- 已开始但尚无 validated 为 `in_progress`；
- 至少一个 validated 但未全部 validated 为 `partial`；
- 全部 validated 为 `complete`；
- 无 validated 且所有未完成项都 blocked 为 `blocked`。

`acceptanceStatus`：存在任一 rejected 为 `rejected`；否则无 accepted 为 `pending`，部分 accepted 为 `partial`，全部 accepted 为 `accepted`。

## 外部目录布局

现有 workspace identity 与存储优先级不变：

```text
<state-root>/design-context-bridge/workspaces/<workspace>/
├── workspace.json
├── migration.json
└── migration.v1.backup.json

<cache-root>/design-context-bridge/workspaces/<workspace>/
├── packages/
│   └── <existing-package-layout>/
└── evidence/
    └── batches/
        └── <batchId>/
            └── <unitId>/
                └── run-0001/
                    ├── actual.png
                    ├── actual-context.png
                    ├── visual-findings.json
                    └── business-results.json
```

设计原稿继续保存在 package 中，不复制进 evidence。evidence 通过 `packageRef + packageFingerprint` 指向使用的设计内容版本。所有路径默认位于目标业务仓库之外。

## CLI contract

### Existing commands

现有 `workspace resolve`、`prepare`、`validate-package`、package `inspect`、`render`、`status`、`migration init/validate/import` 保持兼容。`prepare` 仍一次处理一个 URL；批次循环属于 Skill。

现有 manifest `fingerprint` 只表示 provider/document/node/format/scale 组成的 request/cache identity；设计内容更新后该值不会变化，因此必须保留它并新增 `contentFingerprint`。`contentFingerprint` 对规范化 `design.json`、根截图 bytes、按 node ID 排序的已下载资产 bytes、export 参数以及非敏感 package 状态做 SHA-256。它不读取 `source/raw.json` 中可能波动的远端元数据。任何内容 bytes 变化都保守地视为需要重新验证，即使最终视觉可能相同。

`prepare --json` 增加 `data.requestFingerprint`、`data.packageFingerprint` 和 `data.canonicalDesignSource`。其中 `packageFingerprint` 等于 `contentFingerprint`，使 Agent 无需重新解析 manifest 就能绑定 unit；`requestFingerprint` 保持现有缓存身份语义。

### Batch apply

```bash
design-context migration batch apply "$TARGET_DIR" \
  --input "$BATCH_JSON" \
  [--expected-state-fingerprint "$FINGERPRINT"] \
  --json
```

- 新 batch 校验后创建；
- 相同 ID、相同内容幂等成功；
- 相同 ID、内容变化要求当前 state fingerprint；
- 更新采用 upsert，不因输入省略已有 unit 而删除；
- 定义变化自动 reopen 受影响 unit 及其依赖；
- 重复 ID、未知依赖、循环依赖或无效落点使整次写入失败。

`BATCH_JSON` 使用只含业务映射和已解析设计绑定的 `BatchDefinition/UnitDefinition`，不允许携带 revision、status、blockers、evidence、validationHistory、acceptance、runtimeLocator 或 implementationFiles。CLI 创建 runtime state，防止调用方通过 batch 输入伪造 implemented、validated、accepted 或已分析的代码落点。

### Bounded inspect

```bash
design-context migration inspect "$TARGET_DIR" \
  [--batch "$BATCH_ID"] \
  [--unit "$UNIT_ID"] \
  --json
```

`migration validate` 返回 schema、state fingerprint 和 batch summaries；`migration inspect` 只返回指定 batch 或 unit，避免随着历史增长读取完整状态。

### Unit mutation

```bash
design-context migration unit update "$TARGET_DIR" \
  --batch "$BATCH_ID" \
  --unit "$UNIT_ID" \
  --expected-revision 3 \
  --input "$MUTATION_JSON" \
  [--confirmed-by-user] \
  --json
```

Mutation 使用受控 discriminated union，不接受任意 JSON Patch：

```json
{ "action": "start" }
{ "action": "mark-implemented", "implementationFiles": ["src/pages/account/Orders.tsx"], "runtimeLocator": "打开 /account/orders，点击筛选按钮后定位 role=dialog[name='订单筛选']" }
{ "action": "block", "blockers": [{ "code": "login_required", "message": "需要有效测试会话", "retryable": true }] }
{ "action": "mark-validated", "packageFingerprint": "64位内容指纹", "visualEvidence": ["batches/account/orders-filter/run-0001/actual.png"], "businessEvidence": ["orders-filter.e2e: passed"] }
{ "action": "reopen", "reason": "design_changed" }
{ "action": "accept", "note": "人工确认通过" }
{ "action": "reject", "reason": "弹窗间距不正确" }
{ "action": "update-definition", "changes": {} }
```

### Approved reference mutation

```bash
design-context migration reference update "$TARGET_DIR" \
  --expected-state-fingerprint "$FINGERPRINT" \
  --input "$REFERENCE_MUTATION_JSON" \
  --confirmed-by-user \
  --json
```

支持 `approve-unit`、`approve-existing` 和 `revoke`。`approve-unit` 要求目标 unit 已 validated 且 accepted；`approve-existing` 要求明确实现目标和实现文件；`revoke` 保留历史记录但使所有 consumers 失效。没有 `--confirmed-by-user` 时拒绝任何参考变更。

### Concurrency and atomicity

- Migration state 使用外部跨进程锁；锁内重新读取最新状态后执行单 unit 更新并原子替换。
- 锁等待有上限，崩溃遗留锁通过安全 stale-lock 策略处理。
- 不同 unit 可以并行更新；同一 unit revision 不匹配时返回冲突。
- CLI 不允许最后写入者静默覆盖已有结果。

### Input path safety

`--input` 文件必须位于系统临时目录或外部 workspace。解析真实路径后若位于目标 Git 工作区，默认拒绝；手工模式只有显式 `--allow-in-repo` 才允许，Skill 永不使用该模式。

## 自然语言优先的 Intake

结构化 schema 是 Agent 与 CLI 之间的内部契约，不是用户表单。

### Default mode

用户直接使用自然语言，例如：

> 在当前项目改造个人中心。Figma A 对应我的订单列表页；Figma B 对应订单页点击筛选打开的弹窗；Figma C 对应订单详情的退款 Tab。A 和 C 是改造，B 是新功能。可以参考 `/checkout`，订单 API、分页和筛选参数不能改变。

Agent 从用户、适用项目说明和外部 migration state 提取候选 units，生成一次可读执行契约：

| 设计 | 系统落点 | 类型 | 变更 | 如何进入 | 参考 | 保护边界 |
|---|---|---|---|---|---|---|
| Figma A | 我的订单列表 | 页面 | 改造 | 进入个人中心订单页 | `/checkout` | API、分页不变 |
| Figma B | 订单筛选 | 弹窗 | 新增 | 点击筛选 | `/checkout` | 参数格式不变 |
| Figma C | 退款内容 | Tab | 改造 | 订单详情 -> Refund | `/checkout` | 退款流程不变 |

每项信息标明来源：用户明确指定、可信项目说明、已有 migration state 或 Agent 推断。只有关键的 Agent 推断必须让用户确认。

### Adaptive clarification

- 只有一两个缺失信息时，一次询问最关键问题；
- 多个 unit 都有缺失时，用一张带“待确认”单元格的表集中展示，避免大量往返；
- 某个候选 unit 不清楚时，只暂停该候选，其他完整 unit 可以先登记和执行；
- 用户声明批次通用参考或保护规则时，输入层只问一次，写入 state 时展开到每个 unit；
- 追问使用业务语言，不要求用户填写内部字段名。

完整映射形成后，Agent 只做一次执行范围确认；确认前不得扫描或修改目标仓库。

### Optional Markdown template

为批量任务提供可选 Markdown 模板。模板是人类友好的输入方式，不是另一套状态格式：

```markdown
# Design replication batch

## Batch
- Name: 个人中心改造
- Target repository: /path/to/repository
- Common approved references: /checkout
- Common protected behavior: 订单 API、分页和筛选参数不能改变

## Unit: 我的订单列表
- Design URL: https://www.figma.com/design/...
- System target: /account/orders 页面
- Change: refactor
- Activation: 进入个人中心后打开我的订单
- Scope: 订单列表区域

## Unit: 订单筛选弹窗
- Design URL: https://www.figma.com/design/...
- System target: 我的订单页筛选弹窗
- Change: new
- Activation: 点击筛选按钮
- Scope: 弹窗和遮罩
```

Agent 读取 Markdown 后仍展示执行契约并确认，不直接把 Markdown 当作可信 migration state。模板不要求用户填写 ID、fingerprint、revision、locator、文件路径或证据路径。

### Continuation

跨会话时用户可直接说“继续个人中心批次，只处理上次阻塞的筛选弹窗”。Agent 通过外部 state 恢复已确认事实，只核实当前 unit、设计 URL 是否变化和新增保护规则，不要求重新填写整个批次。

### No CLI wizard

不增加交互式 CLI wizard。Codex 和 Claude Code 已经提供对话层；CLI 保持非交互和确定性，避免 TTY 自动化、双重会话状态和重复业务理解。

## Skill workflow

1. 解析外部 workspace 并校验 migration state。
2. 从自然语言或可选 Markdown 提取 batch/unit 候选。
3. 仅追问缺失或冲突的业务事实，展示一次执行契约。
4. 用户确认后由 Agent 生成内部 JSON；先通过显式 reference mutation 登记本次新批准参考。
5. 对每个不同设计 URL 执行 `prepare --target`；相同设计来源复用 package，并把成功结果的规范化来源、packageRef 和 content fingerprint 写入 batch definition。
6. 原子写入 batch；语法可解析但下载失败的设计仍以规范化来源和空 package 绑定登记，随后只阻塞引用它的 unit。无法解析 provider/document/node 的 URL 留在 intake 待确认区，不伪造合法 unit。
7. 按 `dependsOn` 排序；无依赖且代码范围不重叠的 unit 可以并行。
8. 只读取宿主入口、直接组件、批准参考和受保护业务依赖。
9. 有界分析后记录实现文件和运行定位方式。
10. 每个 unit 独立实施、截图、视觉比较和业务验证。
11. 单个 unit 通过后立即标记 `validated`，不等待整个 batch。
12. 向用户分别列出可验收、阻塞和未开始 unit。
13. 只有用户明确确认后记录 `accepted`。
14. 提交前检查暂存区和业务仓库污染。

Agent 不直接编辑 `migration.json`。

## Visual evidence by target type

| 类型 | 主要视觉证据 |
|---|---|
| `page` | 目标路由完整 viewport 或完整页面截图 |
| `modal` / `drawer` | 弹层区域截图和宿主上下文截图 |
| `tab` | 激活后的 Tab 内容截图和宿主截图 |
| `form` / `section` | 明确区域截图和布局上下文截图 |
| `component` | 实际业务宿主或可信运行入口中的组件截图 |
| `flow` | 执行 activation 后的目标状态截图及交互证据 |

独立弹窗或局部设计只与实际目标区域比较，不要求整个宿主页面匹配 Figma。如果设计包含遮罩、周围布局或宿主上下文，则把这些内容纳入 unit scope。原稿和实际证据保持相同 viewport、DPR、locale、断点和稳定数据状态。

CLI 不做图片识别。多模态 Agent 必须查看原稿和实际截图，迭代到没有未解决的高、中优先级差异；低优先级差异进入报告。

## Business validation

每个 validated unit 都必须有非空业务证据：

- `new` 至少需要构建或类型检查、目标可达、无相关控制台错误和设计要求交互；
- `refactor` 还必须验证既有 API、状态、校验、错误处理和 protected flow；
- `modal`、`tab`、`form`、`flow` 必须真实执行 activation；
- 共享代码变化时重新验证所有直接受影响 unit。

视觉通过但业务失败时仅阻塞当前 unit，其他 unit 继续。

## Shared components and dependencies

- `dependsOn` 只描述 unit 级设计依赖。
- 代码层公共组件没有独立设计来源时不登记为 unit。
- 上游 unit reopen 或定义变化时，CLI 使直接和间接依赖 unit 失效。
- approved reference 修改、撤销或源 unit reopen/rejected 时，CLI 使所有直接和间接 consumers 失效。
- 多个 unit 修改同一文件时默认顺序实施。
- 是否复用组件只依据用户指定参考和必要直接依赖，不扫描整个组件库。

## Design changes and recovery

- `prepare --refresh` 得到不同 `contentFingerprint` 时，引用旧内容版本的 units 全部 reopen；request/cache fingerprint 不用于判断设计更新。
- 宿主入口、scope、activation、protected 或依赖定义变化时 reopen。
- unit 定义变化时清空旧 runtime locator 和 implementation files，要求 Agent 在新边界下重新做有界定位；完全幂等的 batch apply 不清空这些运行字段。
- reopen 把当前 unit revision、设计绑定、实现落点/runtime locator/文件、证据、内容指纹和 acceptance snapshot 写入 `validationHistory`，再清空活动证据和当前 acceptance；只有定义边界变化才按上一条清空 runtime locator/files。
- 历史 evidence 文件不自动删除，但不能满足当前验证门禁。
- 实施失败不自动回滚业务代码；Agent 报告受影响文件并单独处理。

## Schema v1 upgrade

- `migration validate` 通过带 `schemaStatus` 的只读 union 识别 v1/v2，并返回实际 schemaVersion 与升级诊断；读取 v1 不使用类型断言伪装成 v2。
- 空 v1 在首次 v2 写操作时可以自动升级。
- 非空 v1 targets 不自动猜测类型和系统落点。
- `migration upgrade TARGET --input EXPLICIT_MAPPING_JSON --json` 使用只含 batch/unit definitions 与旧 target 索引映射的显式输入，禁止携带运行状态、证据或 acceptance。
- 升级前在外部 state directory 保存经校验的备份。
- 映射不完整、状态冲突或校验失败时不修改原状态。
- v1 的旧验证结果不直接升级为当前验证；新 unit 从 pending 开始并返回 `legacy_revalidation_required` 诊断，旧字节完整保存在备份中。
- 已有 approved references 经校验后保留。

## Error diagnostics

新增稳定 diagnostic codes：

- `duplicate_batch_id`
- `duplicate_unit_id`
- `unknown_dependency`
- `dependency_cycle`
- `invalid_implementation_target`
- `unit_revision_conflict`
- `migration_lock_timeout`
- `package_changed`
- `dependency_changed`
- `approved_reference_revoked`
- `approved_reference_invalid`
- `approved_reference_conflict`
- `evidence_missing`
- `user_confirmation_required`
- `legacy_mapping_required`

所有诊断继续清理 URL、凭据和敏感值。CLI JSON 维持统一 envelope，业务字段放在 `data` 下。

## Repository safety

- package、状态、原始 JSON、截图和证据全部默认在外部 workspace；
- 不自动修改目标仓库 `.gitignore`；
- 不执行 `git add -A`；
- 提交前运行 `git diff --cached --name-only` 和 `git status --porcelain`；
- 检测 `.design-context/`、Playwright 报告、test-results、coverage、截图、原始 JSON 和临时 evidence；
- 发现生成物已暂存时停止提交；
- 登录继续优先使用项目说明、测试账号、现有 session 和自动化登录；MFA、CAPTCHA、SSO 或缺少授权时才要求用户介入；
- 不新增内置浏览器 MCP，必要时继续使用外部 Playwright MCP。

## Verification strategy

### Core tests

- 合法多 batch、多 unit schema；
- 所有 target types 和 new/refactor 混合；
- 重复 ID、未知依赖、循环依赖；
- 安全路径与凭据拒绝；
- 状态转换、非法跳转、证据门禁和人工确认；
- reopen 历史归档与依赖传播；
- approved reference 生命周期和跨 batch consumer 失效；
- content fingerprint 变化且 request fingerprint 保持不变；
- batch summary；
- 不同 unit 并行更新不丢失；
- 同 unit revision 冲突。

### CLI tests

- batch apply 创建、幂等和冲突；
- bounded inspect；
- typed unit mutation；
- prepare request/content 双指纹和规范化来源；
- 工程内 input 默认拒绝且无部分状态；
- v1 空状态升级和非空显式映射；
- 升级失败不覆盖原状态。

### Skill and eval tests

- 自然语言多 unit intake；
- Markdown 批量模板；
- page、modal、tab、form 混合；
- new/refactor 混合；
- 单项通过、单项阻塞、其余继续；
- 同一设计多个落点拆分 units；
- 局部设计使用区域截图；
- package 复用但证据独立；
- 依赖阻塞只影响依赖项；
- 不扫描仓库猜测；
- 不自动人工验收；
- 不暂存生成物；
- CLI 不承担图片理解。

## Acceptance criteria

1. 一个 batch 能包含多个独立设计目标。
2. unit 能表达页面和任意 UI 局部。
3. new/refactor 可以混合。
4. 同一设计多个落点拆成独立 units。
5. 每个 unit 独立准备、实施、阻塞、验证和人工验收。
6. 通过 unit 不受其他阻塞 unit 影响。
7. 局部设计采用区域证据，不要求整个页面匹配。
8. 工具验证和人工接受严格分离。
9. 自然语言是默认入口，Markdown 是可选批量模板，用户无需写 JSON。
10. 设计、依赖或范围变化使旧证据失效。
11. 状态写入具备原子替换、跨进程锁和 revision 冲突保护。
12. 默认不污染目标业务仓库。
13. v1 有安全、非猜测式升级路径。
14. 不破坏现有 provider、prepare、validate、inspect、render、refresh 和安装行为。
15. `npm run check` 全部通过。
16. 在 `mktemp` 临时 Git 仓库完成多 unit 生命周期验证后，`git status --porcelain` 为空。

## Delivery boundary

实现和验证只能使用本仓库与临时 Git 仓库，不修改任何真实业务项目。未经明确授权，不 commit 或 push。
