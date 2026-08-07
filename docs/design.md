# Figma Design Context Skill 需求与技术说明书

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

------------------------------------------------------------------------

# 2. Skill 定位

Skill 名称：

`figma-design-context`

目标：

将 Figma 设计稿转换为 AI Agent 使用的设计上下文包。

核心能力：

-   读取 Figma 文件和节点；
-   提取布局结构；
-   提取设计变量；
-   下载图片和 SVG 资源；
-   生成 AI 可读 Markdown 文档；
-   支持多个 AI Agent 使用。

------------------------------------------------------------------------

# 3. 整体架构

    Figma
      |
      |
    Figma API
      |
      |
    figma-design-context Skill
      |
      +-- design.json
      +-- assets/
      +-- screenshot.png
      +-- components.json
      +-- styles.json
      +-- AI_CONTEXT.md
      |
      |
    AI Agent
    (Codex / Claude Code / Cursor / OpenCode)

------------------------------------------------------------------------

# 4. 核心目标

## 4.1 设计上下文资产化

一次导出：

-   页面结构；
-   样式；
-   组件；
-   图片；
-   Token；

后续所有 AI Agent 可以复用。

------------------------------------------------------------------------

## 4.2 降低 Figma MCP 依赖

解决：

-   MCP 调用限制；
-   网络依赖；
-   多次重复读取。

------------------------------------------------------------------------

## 4.3 提升页面还原度

减少：

-   字体偏差；
-   间距偏差；
-   控件位置偏差；
-   组件重复实现。

------------------------------------------------------------------------

# 5. 功能需求

## 5.1 Figma URL解析

输入：

    https://www.figma.com/design/{fileKey}/...?node-id={nodeId}

自动解析：

-   fileKey
-   nodeId

------------------------------------------------------------------------

## 5.2 节点数据导出

获取：

-   Frame
-   Component
-   Instance
-   Auto Layout
-   Constraints
-   Text Style
-   Fill
-   Stroke
-   Effect

------------------------------------------------------------------------

## 5.3 图片资源导出

支持：

-   PNG
-   JPG
-   SVG

输出：

    assets/

    hero.png
    icon.svg
    product.jpg

------------------------------------------------------------------------

## 5.4 Design Token提取

提取：

-   Color
-   Typography
-   Spacing
-   Radius
-   Shadow

生成：

    styles.json

------------------------------------------------------------------------

## 5.5 AI Context生成

生成：

    AI_CONTEXT.md

内容包括：

-   页面结构；
-   组件说明；
-   样式规范；
-   开发建议。

------------------------------------------------------------------------

# 6. 输出目录设计

    design-context/

    ├── design.json
    ├── components.json
    ├── styles.json
    ├── variables.json
    ├── screenshot.png
    ├── AI_CONTEXT.md
    └── assets/

        ├── images/
        └── icons/

------------------------------------------------------------------------

# 7. AI Agent使用方式

示例：

    Read docs/design-context/checkout/AI_CONTEXT.md

    Use design.json and assets as the source of truth.

    Implement the page according to the design context.

------------------------------------------------------------------------

# 8. 技术方案

## 后端

推荐：

Python

原因：

-   Figma API调用方便；
-   JSON处理成熟；
-   图像处理生态丰富。

## 核心依赖

    requests
    pydantic
    Pillow

------------------------------------------------------------------------

# 9. API设计

## 获取节点

    GET /v1/files/{fileKey}/nodes

用途：

获取页面结构。

## 获取图片

    GET /v1/images/{fileKey}

用途：

下载图片资源。

## 获取组件

    GET /v1/files/{fileKey}/components

用途：

组件映射。

## 获取样式

    GET /v1/files/{fileKey}/styles

用途：

设计规范提取。

------------------------------------------------------------------------

# 10. 数据转换

Figma原始数据：

    TEXT
    fontSize:24
    fontWeight:600

转换：

    Heading Large

    font-size:
    24px

    font-weight:
    600

    usage:
    页面主标题

目标：

让 AI Agent 容易理解。

------------------------------------------------------------------------

# 11. Skill目录结构

    figma-design-context/

    ├── skill.md

    ├── scripts/

    │   ├── export_figma.py
    │   ├── download_assets.py
    │   └── generate_context.py

    ├── templates/

    │   └── AI_CONTEXT.md

    └── README.md

------------------------------------------------------------------------

# 12. 开发阶段

## Phase 1 MVP

实现：

-   URL解析；
-   节点导出；
-   图片下载；
-   JSON生成；
-   Markdown Context生成。

## Phase 2

增加：

-   Component分析；
-   Design Token；
-   自动生成frontend-design-context。

## Phase 3

增加：

-   MCP Server；
-   Agent自动调用；
-   Figma Code Connect。

------------------------------------------------------------------------

# 13. 安全设计

Token：

-   不写入代码；
-   使用环境变量；
-   支持配置文件。

示例：

    FIGMA_TOKEN=xxxx

------------------------------------------------------------------------

# 14. 长期目标

形成：

    Figma
     |
    Design Context Skill
     |
    AI Agent
     |
    Frontend Code
     |
    Playwright Visual QA

成为 AI Native Frontend Engineering Pipeline。

