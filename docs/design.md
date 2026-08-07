# Figma Design Context Skill 需求与技术说明书

> **版本说明**：本文档随实现持续更新。Phase 1 已完成并验证，Phase 2/3 为规划中。
> 最后更新：2026-08-07

## 1. 项目背景

随着 AI Coding Agent（Codex、Claude Code、Cursor、OpenCode
等）的普及，前端开发逐渐从传统的人工实现转向：

Figma 设计稿 → AI 理解设计上下文 → 自动生成代码 → 浏览器视觉验证 →
持续优化。

实际使用过程中发现，仅依靠 Figma MCP 存在以下问题：

-   MCP 调用次数限制；
-   多 Agent 重复读取设计稿；
-   设计上下文无法沉淀；
-   不同 AI Agent 无法共享设计理解；
-   大型项目中容易出现视觉规范不一致。

因此需要建设一个通用的 Figma Design Context Skill，将 Figma
设计信息转换为 AI Agent 可理解、可复用的设计上下文。

---

# 2. Skill 定位

Skill 名称：

`figma-context-bridge`

目标：

将 Figma 设计稿转换为 **本地持久化的设计上下文资产包**，支持两类消费者：

-   **AI Agent**：读取结构化 JSON + Markdown 上下文，用于代码生成
-   **前端开发者 / 浏览器**：打开自动还原的 HTML 页面，直接用于开发

核心能力：

-   读取 Figma 文件和节点（通过 Figma REST API）
-   提取布局结构（node.json）
-   下载图片和 SVG 资源（assets/）
-   将节点树自动还原为可用的 HTML 页面（reconstruct.html）
-   生成 AI 可读 Markdown 文档（AI_CONTEXT.md）— Phase 2
-   提取设计变量（styles.json）— Phase 2
-   支持多个 AI Agent 复用同一资产包

---

# 3. 整体架构

```
Figma
  │
  │  Figma REST API
  ▼
figma-context-bridge
  │
  ├── figma_pipeline.py    (编排器：URL → 缓存检测 → 下载 + 渲染)
  │
  ├── figma_download.py    (底层：URL → 资产包)
  │     ├── node.json            节点树结构数据
  │     ├── screenshot.png       整页截图
  │     ├── manifest.json        节点 → 资源映射
  │     └── assets/              图片/矢量素材
  │
  ├── render_html.py       (底层：资产包 → reconstruct.html)
  │     └── reconstruct.html     自动还原的前端页面
  │
  ▼
消费者
├── AI Agent (Codex / Claude Code / Cursor / OpenCode)
│     └── 读取 node.json + manifest.json + AI_CONTEXT.md (Phase 2)
│
└── 前端开发者 / 浏览器
      └── 打开 reconstruct.html
```

---

# 4. 核心目标

## 4.1 设计上下文资产化

一次导出：

-   页面结构（node.json）
-   样式与布局数据
-   组件
-   图片素材（assets/）
-   Design Token（styles.json）— Phase 2

后续所有 AI Agent 可以复用，无需再次调用 Figma API。

## 4.2 降低 Figma MCP 依赖

解决：

-   MCP 调用次数限制
-   网络依赖
-   多次重复读取

实现方式：**本地缓存 + 编排器**。同一 URL 第二次运行只渲染不下载，零 API 消耗。

## 4.3 提升页面还原度

通过自动 HTML 还原，减少：

-   字体偏差（字号 / 字重 / 行高 / 颜色从 node.json 精确翻译）
-   间距偏差（Auto Layout itemSpacing / padding 翻译为 CSS）
-   控件位置偏差（absoluteBoundingBox 相对父节点定位）
-   组件重复实现（组件复用 manifest 映射）

---

# 5. 功能需求

## 5.1 Figma URL 解析 ✅ 已实现

输入：

    https://www.figma.com/design/{fileKey}/...?node-id={nodeId}

自动解析：

-   fileKey
-   nodeId

支持三种 URL 格式：`/design/`、`/file/`、`/proto/`。

## 5.2 节点数据导出 ✅ 已实现

通过 Figma API `GET /v1/files/{fileKey}/nodes` 获取完整节点树，包含：

-   Frame / Component / Instance / Group
-   Auto Layout（layoutMode / itemSpacing / padding）
-   Constraints
-   Text Style（fontFamily / fontSize / fontWeight / lineHeightPx）
-   Fill（SOLID / GRADIENT / IMAGE，含 blendMode）
-   Stroke
-   Effect（DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR）

输出：`node.json`

## 5.3 图片资源导出 ✅ 已实现

支持：

-   PNG（默认）
-   JPG
-   SVG（矢量零损失）

策略：

-   VECTOR / LINE / ELLIPSE / BOOLEAN_OPERATION 节点 → 导出为图片
-   有 IMAGE fill 的 RECTANGLE → 导出为图片
-   嵌套 Instance 内部节点（ID 含 `;`）→ 自动过滤（随父 Instance 整体导出）
-   批量导出（每批 40 个节点），失败自动降级为逐个重试

输出：`assets/`

## 5.4 HTML 页面还原 ✅ 已实现

将 node.json 递归翻译为 HTML + CSS，生成可直接使用的前端页面。

渲染策略：

| Figma 节点类型 | HTML 渲染方式 |
|---|---|
| `TEXT` | 真文字 `<div>`（字号 / 字重 / 行高 / 颜色 / 对齐从 Figma 翻译） |
| `FRAME` / `RECTANGLE` | CSS `<div>`（fills / strokes / cornerRadius / box-shadow / overflow） |
| `GROUP` | 透明容器（子节点展开到父级） |
| `VECTOR` / `LINE` / `ELLIPSE` | `<img>` 引用 assets/ 中的 PNG |
| `RECTANGLE`（IMAGE fill） | `<img>` 引用 assets/ 中的 PNG |

关键技术处理：

-   **坐标系**：每个节点 `left/top` 相对于直接父节点计算（与 CSS `position:absolute` 定位上下文一致）
-   **blendMode**：节点级 `PASS_THROUGH` → `mix-blend-mode: multiply`；Fill 级白色 `MULTIPLY` → 跳过（无效果操作）
-   **文字裁剪**：TEXT 节点不设固定 height + 不用 `overflow:hidden`（Figma 的 boundingBox.height 常小于 lineHeightPx）

输出：`reconstruct.html`

## 5.5 Design Token 提取 — Phase 2

提取：

-   Color（从 fills 自动归类）
-   Typography（从 TEXT 节点样式聚类）
-   Spacing（从 Auto Layout padding / itemSpacing）
-   Radius（从 cornerRadius）
-   Shadow（从 effects）

生成：`styles.json`

## 5.6 AI Context 生成 — Phase 2

生成：

    AI_CONTEXT.md

内容包括：

-   页面结构摘要
-   组件说明
-   样式规范
-   资源清单
-   开发建议

目标：让 AI Agent 读一份 Markdown 就理解设计意图，无需解析原始 node.json。

---

# 6. 输出目录设计

```
downloads/<fileKey>_<nodeId>/

├── node.json              # 完整 Figma 节点树（布局、文字、样式、组件结构）
├── screenshot.png         # 根节点整页截图（视觉还原的金标准）
├── manifest.json          # node id → 资源文件路径映射
├── reconstruct.html       # 自动还原的前端页面（可直接使用）
├── compare.html           # 还原效果 vs 原稿截图 并排对比（可选）
├── README.md              # 该资产包的元信息
├── AI_CONTEXT.md          # AI 可读的设计上下文说明 — Phase 2
├── styles.json            # Design Token — Phase 2
├── components.json        # 组件映射 — Phase 2
└── assets/                # 所有图片素材
    ├── 001_root_1-2.png
    ├── 002_logo_2-7.png
    └── ...
```

---

# 7. AI Agent 使用方式

## 直接读取资产包

```
Read downloads/<fileKey>_<nodeId>/AI_CONTEXT.md

Use node.json and assets/ as the source of truth.

Implement the page according to the design context.
```

## 浏览器查看还原效果

```
Open downloads/<fileKey>_<nodeId>/reconstruct.html
```

---

# 8. 技术方案

## 语言

Python 3.10+

## 核心依赖

| 依赖 | 用途 | 必须 |
|------|------|------|
| `requests` | Figma REST API 调用 | ✅ |
| `Pillow` | 图片诊断 / 元信息检查（可选） | ❌ 可选 |

> 原始规划中的 `pydantic` 在实际实现中未使用——node.json 直接用 dict 操作，无需 schema 校验。

---

# 9. Figma API 设计

## 获取节点

    GET /v1/files/{fileKey}/nodes?ids={nodeId}

用途：获取页面结构。

## 获取图片

    GET /v1/images/{fileKey}?ids={ids}&format={format}&scale={scale}

用途：导出节点为图片资源。

## 获取组件 — Phase 2

    GET /v1/files/{fileKey}/components

用途：组件映射。

## 获取样式 — Phase 2

    GET /v1/files/{fileKey}/styles

用途：设计规范提取。

---

# 10. 数据转换

Figma 原始数据：

    TEXT
    fontSize: 24
    fontWeight: 600
    characters: "Signature Bonus Night"

还原转换：

    <div style="font-size:24px; font-weight:600; line-height:24px;">
      Signature Bonus Night
    </div>

Design Token 转换 — Phase 2：

    Heading Large
    font-size: 24px
    font-weight: 600
    usage: 页面主标题

目标：让 AI Agent 和前端开发者都容易理解。

---

# 11. 项目目录结构

```
figma-context-bridge/

├── scripts/

│   ├── figma_download.py      # 底层：URL → 资产包（API 调用 + 图片下载）
│   ├── render_html.py         # 底层：资产包 → reconstruct.html（JSON → HTML）
│   └── figma_pipeline.py      # 编排器：URL → 缓存检测 → 下载 + 渲染 + 打开浏览器

├── docs/

│   └── design.md              # 本文档（需求与技术说明书）

├── templates/                 # Phase 2
│   └── AI_CONTEXT.md

├── requirements.txt
├── .gitignore
└── README.md
```

---

# 12. 开发阶段

## Phase 1 MVP ✅ 已完成

已实现：

-   ✅ URL 解析（支持 `/design/` `/file/` `/proto/` 三种格式）
-   ✅ 节点树导出（node.json）
-   ✅ 图片批量下载（含嵌套 Instance 过滤 + 失败重试）
-   ✅ 整页截图（screenshot.png）
-   ✅ manifest.json 生成（节点 → 资源映射）
-   ✅ HTML 页面还原（reconstruct.html）
-   ✅ 本地缓存 + 编排器（figma_pipeline.py）
-   ✅ blendMode 处理（PASS_THROUGH / MULTIPLY）
-   ✅ 坐标系（相对于直接父节点）

验证：在 1920×1795 的支付结算页面上完成还原，文字、布局、背景色、矢量素材全部正确渲染。

## Phase 2 — 规划中

-   Design Token 提取（`styles.json`）
-   AI_CONTEXT.md 自动生成
-   组件映射（`components.json`）
-   组件变体分析（Component Properties / Variants）
-   IMAGE fill 原始位图抽取（通过 `imageRef` 走 `/v1/files/{fileKey}/images`）

## Phase 3 — 规划中

-   MCP Server（让 AI Agent 通过 MCP 工具读取本地缓存的设计上下文）
-   Agent 自动调用
-   Figma Code Connect

---

# 13. 安全设计

Token：

-   不写入代码
-   使用环境变量 `FIGMA_TOKEN`
-   支持命令行参数 `-t / --token`

示例：

    export FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxx

---

# 14. 长期目标

形成：

    Figma
     │
     ▼
    figma-context-bridge (设计上下文资产化)
     │
     ├── reconstruct.html → 人 / 浏览器
     ├── AI_CONTEXT.md   → AI Agent
     ├── styles.json      → Design Token 复用
     │
     ▼
    AI Agent (代码生成)
     │
     ▼
    Frontend Code
     │
     ▼
    Playwright Visual QA (视觉回归验证)

成为 **AI Native Frontend Engineering Pipeline** 的设计上下文基础设施。

---

# 15. 关键技术决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 脚本架构 | 三层分离（download / render / pipeline） | 资产包可独立复用，渲染迭代不触发 API 重调 |
| 坐标系 | 相对于直接父节点 | 与 CSS `position:absolute` 定位上下文一致 |
| VECTOR 渲染 | PNG（默认）/ SVG（可选） | node.json 不含矢量路径数据，HTML 无法画矢量 |
| blendMode | PASS_THROUGH → multiply；白色 MULTIPLY → 跳过 | Figma 导出 PNG 时 blendMode 部分丢失，需 CSS 近似 |
| TEXT 高度 | 不设固定 height | Figma boundingBox.height 常小于 lineHeightPx，固定高度会裁剪文字 |
| 缓存策略 | 检测 node.json 是否存在 | 简单可靠，同一 URL 重跑只渲染不下载 |
