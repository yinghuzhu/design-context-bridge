# figma-context-bridge

给定一个 Figma URL，一键下载设计稿的节点结构 JSON、整页截图、所有图片素材，并自动还原为可直接使用的前端 HTML 页面。

解决的核心痛点：**Figma MCP 调用次数限制 + 多 Agent 重复读取设计稿**。导出一次后，所有 AI Agent 直接读本地文件，不再触碰 Figma API。

## 快速开始

```bash
# 1. 克隆 + 安装
git clone git@github.com:yinghuzhu/figma-context-bridge.git
cd figma-context-bridge
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. 设置 Figma Token（见下方说明）
export FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxx

# 3. 一键下载 + 还原（自动打开浏览器）
python scripts/figma_pipeline.py "https://www.figma.com/design/<fileKey>/<title>?node-id=1:2"
```

浏览器会打开还原后的 HTML 页面，可直接作为前端页面使用。

## 前置条件

| 条件 | 说明 |
|------|------|
| Python | 3.10+ |
| Figma 账号 | 需要 **Personal Access Token**（免费版即可） |
| 网络 | 能访问 `api.figma.com` |

## 获取 Figma Token

1. 登录 Figma → 点击头像 → **Settings**
2. 找到 **Personal access tokens** 区域
3. 输入名称 → 勾选 `File content`（只读）→ 生成
4. 复制 token（形如 `figd_xxx`），设置环境变量：

```bash
export FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxxx
```

## 使用方式

### 一站式（推荐）

```bash
# 下载 + 还原 + 打开浏览器
python scripts/figma_pipeline.py "https://www.figma.com/design/<fileKey>/<title>?node-id=1:2"

# 再次运行同一 URL：跳过下载，仅重新渲染（不消耗 API 配额）
python scripts/figma_pipeline.py URL

# 设计稿有更新，强制重新下载
python scripts/figma_pipeline.py URL --force

# 导出 SVG（矢量零损失，图标更清晰）
python scripts/figma_pipeline.py URL --format svg

# 不自动打开浏览器
python scripts/figma_pipeline.py URL --no-open
```

### 分步使用

```bash
# 只下载资产包（不渲染 HTML）
python scripts/figma_download.py URL -o ./my-output --format png --scale 2

# 只把已有资产包渲染成 HTML
python scripts/render_html.py downloads/<fileKey>_<nodeId>/

# 生成对比页面（还原效果 vs 原稿截图 并排）
python scripts/render_html.py downloads/<fileKey>_<nodeId>/ --compare
```

### 参数参考

**figma_pipeline.py（编排器）**

| 参数 | 说明 |
|------|------|
| `url` | Figma 设计稿 URL（必须含 `?node-id=`） |
| `-o / --out` | 输出根目录，默认 `./downloads/` |
| `-t / --token` | Figma token，默认读 `$FIGMA_TOKEN` |
| `-f / --force` | 强制重新下载，忽略本地缓存 |
| `--no-open` | 不自动打开浏览器 |
| `--no-compare` | 不生成 `compare.html` 对比页 |
| `--format` | `png` / `jpg` / `svg`，默认 `png` |
| `--scale` | 导出倍率，默认 `2` |

**figma_download.py（下载器）**

| 参数 | 说明 |
|------|------|
| `url` | Figma URL |
| `-o / --out` | 输出根目录 |
| `-t / --token` | Figma token |
| `--format` | `png` / `jpg` / `svg` |
| `--scale` | 导出倍率 |
| `--no-screenshot` | 不下载整页截图 |

**render_html.py（渲染器）**

| 参数 | 说明 |
|------|------|
| `package_dir` | 资产包目录路径 |
| `-o / --output` | 输出 HTML 路径 |
| `--compare` | 额外生成 `compare.html`（含原稿截图对比） |

## 输出结构

每次下载 + 渲染后生成：

```
downloads/<fileKey>_<nodeId>/
├── node.json              # 完整 Figma 节点树（布局、文字、样式、组件结构）
├── screenshot.png         # 根节点整页截图（视觉还原的金标准）
├── manifest.json          # node id → 资源文件路径映射
├── reconstruct.html       # ← 还原后的前端页面（可直接使用）
├── compare.html           # 还原效果 vs 原稿截图 并排对比（可选）
├── README.md              # 该资产包的元信息
└── assets/                # 所有图片素材
    ├── 001_root_1-2.png
    ├── 002_logo_2-7.png
    └── ...
```

**`reconstruct.html`** 是纯净的前端页面，无调试 UI，可直接用于：
- 作为前端开发的基础页面
- 交给 AI Agent 作为设计还原的参考
- 视觉走查和设计评审

**`compare.html`** 是并排对比页（左还原 / 右原稿），仅用于自查还原效果。

## 渲染策略

`render_html.py` 递归遍历 `node.json`，按节点类型决定渲染方式：

| Figma 节点类型 | HTML 渲染方式 |
|---|---|
| `TEXT` | 真文字 `<div>`（字号、字重、行高、颜色、对齐全部从 Figma 翻译） |
| `FRAME` / `RECTANGLE` | CSS `<div>`（fills、strokes、cornerRadius、box-shadow、overflow） |
| `GROUP` | 透明容器（子节点直接展开到父级） |
| `VECTOR` / `LINE` / `ELLIPSE` | `<img>` PNG（矢量图形无法用 HTML/CSS 还原路径） |
| `RECTANGLE` (IMAGE fill) | `<img>` PNG（位图素材） |

**坐标系统**：每个节点的 `left/top` 相对于它的直接父节点计算（与 CSS `position:absolute` 的定位上下文一致）。

**blendMode 处理**：
- 节点级 `PASS_THROUGH` → `<img>` 添加 `mix-blend-mode: multiply`（白色变透明，不遮盖下层）
- Fill 级 `MULTIPLY` + 白色 → 跳过（白色 MULTIPLY 是无效果操作）

## 工具架构

```
scripts/
├── figma_download.py    # 底层：URL → 资产包（Figma API 调用、图片下载）
├── render_html.py       # 底层：资产包 → reconstruct.html（JSON → HTML 翻译）
└── figma_pipeline.py    # 编排器：URL → 检测缓存 → 下载 + 渲染 + 打开浏览器
```

**为什么分三个脚本**：资产包是设计上下文的持久化沉淀，必须可独立复用。渲染策略调整、AI_CONTEXT 生成、Design Token 抽取都不该触发 Figma API 重调。编排器带本地缓存——同一 URL 第二次运行只渲染不下载。

## 已知限制

- **矢量图形**：`VECTOR` / `LINE` / `ELLIPSE` 等用 PNG 还原（node.json 不含矢量路径数据）。需要零损失矢量还原则用 `--format svg` 导出 SVG。
- **字体回退**：Figma 设计稿使用的字体（如 `AC Nord Text`）在本地可能未安装，会回退到系统字体，可能导致文字宽度有偏差。
- **cornerSmoothing**：Figma 的 Apple squircle 圆角（cornerSmoothing > 0）CSS 无法完美复现，用普通 `border-radius` 近似。
- **复杂 blendMode**：`BACKGROUND_BLUR` 大半径受浏览器 `backdrop-filter` 上限限制；`LINEAR_DODGE` / `OVERLAY` 等混合模式只能近似。
- **增量更新**：每次下载为全量拉取，不做增量 diff。

## 后续路线

- **Phase 2**：Design Token 提取（`styles.json`）+ `AI_CONTEXT.md` 自动生成 + 组件变体分析
- **Phase 3**：包装为 MCP Server，让 AI Agent 通过 MCP 工具读取本地缓存的设计上下文

## License

MIT
