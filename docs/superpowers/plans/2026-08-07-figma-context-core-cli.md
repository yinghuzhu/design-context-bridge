# Figma Context Core and CLI Implementation Plan

> Historical implementation record. This Python/schema-v2 plan is non-normative; use the repository README, `docs/design.md`, and the active Node.js implementation for current behavior.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有三个脚本整理为可测试、可恢复、面向 Agent 的 Python Core/CLI，并生成完整的版本化设计上下文资产包。

**Architecture:** 保留现有脚本兼容入口，将 URL、API、下载、资产包、上下文生成、渲染和迁移状态拆进 `src/figma_context_bridge/`。所有确定性能力通过 `figma-context` CLI 暴露；JSON 模式只在 stdout 输出最终结果，进度写 stderr，Core 不承担图片理解或视觉验收。

**Tech Stack:** Python 3.10+、requests、pytest、标准库 `argparse`/`dataclasses`/`pathlib`/`tempfile`/`json`

## Global Constraints

- 本项目忽略 Java 和 MySQL 规范。
- 完整设计以 `docs/plans/2026-08-07-agent-figma-replication-design.md` 为准。
- Core/CLI 不实现图片识别、视觉相似度评分、本地视觉模型、MCP 或 HTTP 服务。
- `screenshot.png` 是视觉真值；`reconstruct.html` 只能作为辅助观察结果。
- Figma Token 只能来自 `FIGMA_TOKEN` 或显式参数，不得写入日志、manifest 或迁移状态。
- 下载必须使用临时目录，只有 `complete` 或 `partial` 包才能替换正式缓存；`invalid` 包不得覆盖已有缓存。
- `partial` 是可用状态，不得让 pipeline 在生成上下文前无条件退出。
- 保留 `scripts/figma_download.py`、`scripts/render_html.py`、`scripts/figma_pipeline.py` 作为兼容入口。
- 每个任务只提交列出的文件，提交前运行 `git diff --check`。

---

## Planned File Map

| File | Responsibility |
|---|---|
| `pyproject.toml` | 包元数据、依赖、pytest 配置和 `figma-context` 入口 |
| `src/figma_context_bridge/models.py` | 目标、诊断、状态和验证结果数据结构 |
| `src/figma_context_bridge/url.py` | Figma URL 解析 |
| `src/figma_context_bridge/client.py` | Figma HTTP API、重试、批量图片 URL 和文件下载 |
| `src/figma_context_bridge/package.py` | 资产包路径、schema、指纹、校验和原子替换 |
| `src/figma_context_bridge/downloader.py` | 节点遍历、资产选择和下载编排 |
| `src/figma_context_bridge/context.py` | `AI_CONTEXT.md`、`styles.json`、`components.json` |
| `src/figma_context_bridge/renderer.py` | 从现有脚本迁移的 HTML 渲染 |
| `src/figma_context_bridge/migration.py` | 目标仓库 `.figma-context/migration.json` schema 和校验 |
| `src/figma_context_bridge/cli.py` | `prepare`、`inspect`、`validate-package`、`render`、`status`、`migration` |
| `tests/fixtures/` | 不依赖实时 Figma API 的固定样本 |
| `tests/` | 单元、集成和兼容入口测试 |

### Task 1: Package Skeleton and URL Contract

**Files:**
- Create: `pyproject.toml`
- Create: `src/figma_context_bridge/__init__.py`
- Create: `src/figma_context_bridge/__main__.py`
- Create: `src/figma_context_bridge/models.py`
- Create: `src/figma_context_bridge/url.py`
- Create: `tests/test_url.py`

**Interfaces:**
- Produces: `FigmaTarget(file_key: str, node_id: str)` and `parse_figma_url(url: str) -> FigmaTarget`.
- Produces: `PackageStatus`, `Diagnostic`, and `PackageValidation` used by all later tasks.

- [ ] **Step 1: Add failing URL and model tests**

```python
import pytest

from figma_context_bridge.models import PackageStatus
from figma_context_bridge.url import parse_figma_url


@pytest.mark.parametrize("kind", ["design", "file", "proto"])
def test_parse_supported_figma_urls(kind: str) -> None:
    target = parse_figma_url(
        f"https://www.figma.com/{kind}/abc123/title?node-id=1010-6349"
    )
    assert target.file_key == "abc123"
    assert target.node_id == "1010:6349"
    assert target.cache_key == "abc123_1010-6349"


def test_parse_requires_node_id() -> None:
    with pytest.raises(ValueError, match="node-id"):
        parse_figma_url("https://www.figma.com/design/abc123/title")


def test_package_status_values_are_stable() -> None:
    assert [item.value for item in PackageStatus] == ["complete", "partial", "invalid"]
```

- [ ] **Step 2: Run the test and verify import failure**

Run: `python -m pytest tests/test_url.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'figma_context_bridge'`.

- [ ] **Step 3: Add packaging and the exact shared models**

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "figma-context-bridge"
version = "0.2.0"
requires-python = ">=3.10"
dependencies = ["requests>=2.31"]

[project.optional-dependencies]
test = ["pytest>=8.0"]

[project.scripts]
figma-context = "figma_context_bridge.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

```python
# src/figma_context_bridge/models.py
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class PackageStatus(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    INVALID = "invalid"


@dataclass(frozen=True)
class FigmaTarget:
    file_key: str
    node_id: str

    @property
    def cache_key(self) -> str:
        return f"{self.file_key}_{self.node_id.replace(':', '-')}"


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    retryable: bool = False
    node_id: str | None = None


@dataclass(frozen=True)
class PackageValidation:
    status: PackageStatus
    diagnostics: tuple[Diagnostic, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "diagnostics": [asdict(item) for item in self.diagnostics],
        }
```

```python
# src/figma_context_bridge/url.py
from urllib.parse import parse_qs, urlparse

from .models import FigmaTarget


def parse_figma_url(url: str) -> FigmaTarget:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    file_key = None
    for kind in ("design", "file", "proto"):
        if kind in parts:
            index = parts.index(kind)
            if index + 1 < len(parts):
                file_key = parts[index + 1]
            break
    if not file_key:
        raise ValueError(f"Cannot find fileKey in URL: {url}")
    node_id = parse_qs(parsed.query).get("node-id", [None])[0]
    if not node_id:
        raise ValueError(f"URL missing ?node-id= query parameter: {url}")
    return FigmaTarget(file_key=file_key, node_id=node_id.replace("-", ":"))
```

`__init__.py` exports `FigmaTarget`, `PackageStatus`, and `parse_figma_url`; `__main__.py` imports and executes `cli.main`.

- [ ] **Step 4: Install editable package and pass tests**

Run: `python -m pip install -e '.[test]' && python -m pytest tests/test_url.py -v`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the package foundation**

```bash
git add pyproject.toml src/figma_context_bridge tests/test_url.py
git diff --cached --check
git commit -m "refactor: establish figma context core package"
```

### Task 2: Versioned Package Schema and Validation

**Files:**
- Create: `src/figma_context_bridge/package.py`
- Create: `tests/test_package.py`
- Create: `tests/fixtures/minimal-package/node.json`
- Create: `tests/fixtures/minimal-package/screenshot.png`
- Create: `tests/fixtures/minimal-package/manifest.json`

**Interfaces:**
- Consumes: `FigmaTarget`, `Diagnostic`, `PackageStatus`, `PackageValidation`.
- Produces: `PackagePaths.for_target(root, target)`, `build_fingerprint(target, fmt, scale)`, `validate_package(path)`, and `publish_staging(staging, destination)`.

- [ ] **Step 1: Write failing validation tests**

```python
import json
from pathlib import Path

from figma_context_bridge.models import PackageStatus
from figma_context_bridge.package import validate_package


def test_valid_minimal_package_is_complete(tmp_path: Path) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "node.json").write_text('{"nodes":{"1:2":{"document":{"id":"1:2","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":10,"height":10}}}}}')
    (tmp_path / "screenshot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "manifest.json").write_text(json.dumps({"schemaVersion": 2, "status": "complete", "screenshot": "screenshot.png", "files": {}, "diagnostics": []}))
    assert validate_package(tmp_path).status is PackageStatus.COMPLETE


def test_missing_screenshot_is_invalid(tmp_path: Path) -> None:
    (tmp_path / "node.json").write_text('{"nodes":{}}')
    (tmp_path / "manifest.json").write_text('{"schemaVersion":2,"status":"complete","screenshot":"screenshot.png","files":{},"diagnostics":[]}')
    result = validate_package(tmp_path)
    assert result.status is PackageStatus.INVALID
    assert {item.code for item in result.diagnostics} == {"missing_screenshot"}


def test_manifest_asset_failure_is_partial(tmp_path: Path) -> None:
    (tmp_path / "node.json").write_text('{"nodes":{}}')
    (tmp_path / "screenshot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "manifest.json").write_text(json.dumps({
        "schemaVersion": 2,
        "status": "partial",
        "screenshot": "screenshot.png",
        "files": {},
        "diagnostics": [{"code":"asset_missing","message":"2:3","retryable":True,"node_id":"2:3"}],
    }))
    assert validate_package(tmp_path).status is PackageStatus.PARTIAL
```

- [ ] **Step 2: Verify the tests fail**

Run: `python -m pytest tests/test_package.py -v`

Expected: FAIL because `figma_context_bridge.package` does not exist.

- [ ] **Step 3: Implement paths, fingerprint, schema validation, and atomic publication**

Implement these exact signatures and rules in `package.py`:

```python
@dataclass(frozen=True)
class PackagePaths:
    root: Path
    node: Path
    screenshot: Path
    manifest: Path
    assets: Path

    @classmethod
    def for_target(cls, output_root: Path, target: FigmaTarget) -> "PackagePaths":
        root = output_root / target.cache_key
        return cls(root, root / "node.json", root / "screenshot.png", root / "manifest.json", root / "assets")


def build_fingerprint(target: FigmaTarget, fmt: str, scale: int) -> str:
    value = {"fileKey": target.file_key, "nodeId": target.node_id, "format": fmt, "scale": scale}
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()
```

`validate_package(package_dir)` parses `manifest.json`, requires `schemaVersion == 2`, parses `node.json`, resolves the screenshot filename from manifest, and returns `invalid` diagnostics for every missing or malformed required file. Otherwise it converts manifest diagnostics to `Diagnostic` and returns the declared `complete` or `partial` status. `publish_staging(staging_dir, destination)` validates first, moves an existing destination to a sibling UUID backup, moves staging into place with `os.replace`, restores the backup on failure, and removes the backup only after success.

- [ ] **Step 4: Pass package tests including rollback**

Add a test that monkeypatches the second `os.replace` call to raise `OSError`, then asserts the original destination content was restored.

Run: `python -m pytest tests/test_package.py -v`

Expected: all package tests PASS.

- [ ] **Step 5: Commit package schema and validation**

```bash
git add src/figma_context_bridge/package.py tests/test_package.py tests/fixtures/minimal-package
git diff --cached --check
git commit -m "feat: add versioned context package validation"
```

### Task 3: Resilient Figma API Client

**Files:**
- Create: `src/figma_context_bridge/client.py`
- Create: `tests/test_client.py`

**Interfaces:**
- Produces: `FigmaClient(token, session=None)`, `fetch_node(target)`, `export_image_urls(file_key, node_ids, fmt, scale)`, and `download(url, destination)`.
- Returns colon-form node IDs from `export_image_urls` regardless of Figma response key format.

- [ ] **Step 1: Write failing HTTP behavior tests with a fake Session**

Add these tests using a `FakeSession` whose queued responses expose `status_code`, `headers`, `json()`, `raise_for_status()`, and `iter_content()`:

```python
def test_export_batches_at_40_ids(fake_session) -> None:
    fake_session.queue_json({"images": {}})
    fake_session.queue_json({"images": {}})
    client = FigmaClient("test-token", fake_session)
    client.export_image_urls("file", [f"{index}:1" for index in range(41)], "png", 2)
    assert [len(call["params"]["ids"].split(",")) for call in fake_session.calls] == [40, 1]


def test_export_normalizes_dash_ids_to_colon_ids(fake_session) -> None:
    fake_session.queue_json({"images": {"1-2": "https://assets/1"}})
    urls, diagnostics = FigmaClient("test-token", fake_session).export_image_urls("file", ["1:2"], "png", 2)
    assert urls == {"1:2": "https://assets/1"}
    assert diagnostics == ()


def test_download_streams_to_destination(fake_session, tmp_path) -> None:
    fake_session.queue_bytes([b"first", b"second"])
    destination = tmp_path / "asset.png"
    FigmaClient("test-token", fake_session).download("https://assets/1", destination)
    assert destination.read_bytes() == b"firstsecond"
```

The fake session records method, URL, headers, params, and timeout so assertions do not require network access. Add one test that queues an HTTP 400 batch response followed by successful per-ID responses and asserts only the rejected ID produces `asset_export_failed`. Add one test that queues 429 with `Retry-After: 0`, followed by 200, and asserts the request was retried exactly once.

- [ ] **Step 2: Verify client tests fail**

Run: `python -m pytest tests/test_client.py -v`

Expected: FAIL because `FigmaClient` is missing.

- [ ] **Step 3: Implement the client without logging secrets**

```python
class FigmaClient:
    def __init__(self, token: str, session: requests.Session | None = None) -> None:
        if not token:
            raise ValueError("Figma token required")
        self._token = token
        self._session = session or requests.Session()

    def fetch_node(self, target: FigmaTarget) -> dict[str, Any]:
        response = self._request("GET", f"/v1/files/{target.file_key}/nodes", params={"ids": target.node_id}, timeout=90)
        return response.json()
    def export_image_urls(
        self,
        file_key: str,
        node_ids: Sequence[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]:
        return self._export_in_batches(file_key, node_ids, fmt, scale, batch_size=40)

    def download(self, url: str, destination: Path) -> None:
        response = self._request("GET", url, timeout=180, stream=True, absolute_url=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as handle:
            for chunk in response.iter_content(8192):
                if chunk:
                    handle.write(chunk)
```

Implement `_request` to attach `X-Figma-Token` without logging it. Retry only 429 and 5xx responses, honor numeric `Retry-After`, otherwise use bounded delays `0.5`, `1.0`, and `2.0` seconds. A failed batch retries each node once and returns `Diagnostic(code="asset_export_failed", retryable=True, node_id=node_id)` instead of throwing away successful URLs.

- [ ] **Step 4: Pass the complete client suite**

Run: `python -m pytest tests/test_client.py -v`

Expected: all tests PASS without a live network call.

- [ ] **Step 5: Commit the API client**

```bash
git add src/figma_context_bridge/client.py tests/test_client.py
git diff --cached --check
git commit -m "feat: add resilient figma api client"
```

### Task 4: Atomic Downloader and Cache Semantics

**Files:**
- Create: `src/figma_context_bridge/downloader.py`
- Create: `tests/test_downloader.py`
- Modify: `scripts/figma_download.py`

**Interfaces:**
- Consumes: `FigmaClient`, package validation/publication, and shared models.
- Produces: `PrepareOptions`, `PrepareResult`, `collect_export_targets`, and `prepare_package`.

- [ ] **Step 1: Write failing downloader tests**

Create `FakeFigmaClient` with configurable node data, image URL mapping, download payloads, and diagnostics. Write six tests that assert: schema version 2 and generated README; a failed non-root asset publishes `partial`; a missing root screenshot preserves an existing sentinel cache file; an equal fingerprint returns `cache_hit=True` without calling the client; SVG does not reuse a PNG fingerprint; and force replacement removes a stale asset absent from the new manifest.

- [ ] **Step 2: Verify downloader tests fail**

Run: `python -m pytest tests/test_downloader.py -v`

Expected: FAIL because downloader interfaces are undefined.

- [ ] **Step 3: Implement preparation with a staging directory**

```python
@dataclass(frozen=True)
class PrepareOptions:
    output_root: Path
    fmt: str = "png"
    scale: int = 2
    force: bool = False


@dataclass(frozen=True)
class PrepareResult:
    package_dir: Path
    validation: PackageValidation
    cache_hit: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "packageDir": str(self.package_dir),
            "cacheHit": self.cache_hit,
            **self.validation.to_dict(),
        }


def collect_export_targets(root_node: dict[str, Any]) -> list[dict[str, str]]:
    """Return deduplicated export targets in depth-first order."""
```

`collect_export_targets` recursively selects IMAGE-fill nodes plus `INSTANCE`, `COMPONENT`, `VECTOR`, and `BOOLEAN_OPERATION`, rejects nested instance IDs containing `;`, and deduplicates by colon-form ID while preserving traversal order. `prepare_package(source_url, client, options)` parses the target, checks a validated matching fingerprint unless forced, creates a sibling staging directory, writes node data, downloads root and selected assets, records diagnostics, generates README, validates the staging package, then publishes it atomically. Download the root screenshot with the actual requested suffix and record its filename in manifest; use `screenshot.png` only for PNG. Manifest schema version 2 includes `source`, `root`, `export`, `fingerprint`, `status`, `files`, and `diagnostics`.

- [ ] **Step 4: Convert the old downloader script into a compatibility wrapper**

`scripts/figma_download.py` imports `figma_context_bridge.cli` and translates its legacy arguments to the new `prepare` handler. Keep all documented legacy flags and return success for both `complete` and `partial`; print partial diagnostics before exiting.

Run: `python -m pytest tests/test_downloader.py -v`

Expected: all downloader and cache tests PASS.

- [ ] **Step 5: Commit the downloader migration**

```bash
git add src/figma_context_bridge/downloader.py scripts/figma_download.py tests/test_downloader.py
git diff --cached --check
git commit -m "feat: make figma downloads atomic and recoverable"
```

### Task 5: AI Context, Styles, and Components

**Files:**
- Create: `src/figma_context_bridge/context.py`
- Create: `tests/test_context.py`
- Create: `tests/fixtures/payment-node-small.json`

**Interfaces:**
- Produces: `generate_context_files(package_dir: Path) -> tuple[Path, Path, Path]`.
- Produces deterministic `AI_CONTEXT.md`, `styles.json`, and `components.json` without network access.

- [ ] **Step 1: Write failing deterministic extraction tests**

Write four fixture-backed tests. The first asserts root name/dimensions, top-level frame names, visible text, and manifest asset paths appear in `AI_CONTEXT.md`. The second asserts duplicate colors and typography collapse into one entry with `usageCount == 2`. The third asserts a component ID, instance component ID, and variant properties appear in `components.json`. The fourth runs generation twice and asserts byte equality for all three outputs.

The fixture must include a FRAME, TEXT, SOLID fill, radius, shadow, COMPONENT, INSTANCE, component properties, and an IMAGE-filled RECTANGLE.

- [ ] **Step 2: Verify extraction tests fail**

Run: `python -m pytest tests/test_context.py -v`

Expected: FAIL because `generate_context_files` is missing.

- [ ] **Step 3: Implement bounded, deterministic context generation**

Implement `walk_nodes(node)` as a depth-first generator. Implement `extract_styles(root)` with normalized RGBA, typography, spacing, radius, and effect keys plus sorted node usage. Implement `extract_components(root)` for COMPONENT, COMPONENT_SET, INSTANCE, variant properties, and referenced component IDs. Implement `render_ai_context(root, manifest)` as deterministic Markdown. `generate_context_files(package_dir)` loads the selected root from node and manifest metadata, writes UTF-8 outputs, and returns their three paths.

Sort every generated collection by stable key. `AI_CONTEXT.md` contains root dimensions, top-level regions, visible text, component summary, asset inventory, and the explicit source-of-truth priority. It must not inline raw image bytes, signed Figma URLs, or the full JSON tree.

- [ ] **Step 4: Run context tests and inspect fixture output**

Run: `python -m pytest tests/test_context.py -v`

Expected: all context tests PASS and a second generation produces identical hashes.

- [ ] **Step 5: Commit context generation**

```bash
git add src/figma_context_bridge/context.py tests/test_context.py tests/fixtures/payment-node-small.json
git diff --cached --check
git commit -m "feat: generate agent-ready figma context"
```

### Task 6: Renderer Migration and Format Correctness

**Files:**
- Create: `src/figma_context_bridge/renderer.py`
- Create: `tests/test_renderer.py`
- Modify: `scripts/render_html.py`

**Interfaces:**
- Produces: `render_package(package_dir, output=None, compare=False) -> RenderResult`.
- Preserves current relative-coordinate, text, vector/image, fill, stroke, radius, effect, and comparison behavior.

- [ ] **Step 1: Write failing renderer regression tests**

Test exact generated fragments for relative coordinates, escaped text, IMAGE asset paths, vector assets, missing manifest behavior, and compare-page screenshot filename from manifest rather than a hard-coded `.png` name.

```python
def test_render_uses_manifest_screenshot_filename(tmp_path: Path) -> None:
    result = render_package(tmp_path, compare=True)
    assert 'src="screenshot.svg"' in result.compare_path.read_text()
```

- [ ] **Step 2: Verify renderer tests fail**

Run: `python -m pytest tests/test_renderer.py -v`

Expected: FAIL because package renderer is missing.

- [ ] **Step 3: Move renderer logic into the package**

Keep existing converter behavior in focused functions and expose:

```python
@dataclass(frozen=True)
class RenderResult:
    html_path: Path
    compare_path: Path | None
    width: float
    height: float


def render_package(
    package_dir: Path,
    output: Path | None = None,
    compare: bool = False,
) -> RenderResult:
    """Render a validated package and optionally its comparison page."""
```

The body validates the package, loads the root named by manifest `source.nodeId`, delegates node rendering to `Renderer`, writes the standalone page, and writes comparison HTML only when requested and the manifest screenshot exists. Read the screenshot path from manifest, escape titles/text, and raise a typed package error for empty `nodes` or missing `absoluteBoundingBox` instead of leaking `StopIteration` or `KeyError`.

- [ ] **Step 4: Replace the script body with a compatibility wrapper and pass tests**

Run: `python -m pytest tests/test_renderer.py -v && python scripts/render_html.py downloads/RPTaoLvpTfNZ5Gx7bYRvb8_1010-6349 -o /tmp/figma-context-render-test.html`

Expected: tests PASS and the smoke command prints the output path without changing the cached package.

- [ ] **Step 5: Commit the renderer migration**

```bash
git add src/figma_context_bridge/renderer.py scripts/render_html.py tests/test_renderer.py
git diff --cached --check
git commit -m "refactor: move html rendering into core package"
```

### Task 7: Migration State Schema

**Files:**
- Create: `src/figma_context_bridge/migration.py`
- Create: `tests/test_migration.py`
- Create: `examples/migration.json`

**Interfaces:**
- Produces: `init_migration_state(target_dir)`, `load_migration_state(target_dir)`, and `validate_migration_state(data)`.
- Writes only `.figma-context/migration.json`; credentials are rejected by key name.

- [ ] **Step 1: Write failing migration-state tests**

Write five tests using the exact schema below. Assert init creates it; `approvedByUser: false` is rejected; `status: validated` without both evidence arrays is rejected; nested keys named `password`, `token`, `cookie`, `secret`, and `authorization` are rejected case-insensitively; and a monkeypatched `os.replace` failure preserves the prior file.

- [ ] **Step 2: Verify migration tests fail**

Run: `python -m pytest tests/test_migration.py -v`

Expected: FAIL because migration-state functions are missing.

- [ ] **Step 3: Implement schema version 1**

The exact top-level shape is:

```json
{
  "schemaVersion": 1,
  "targets": [],
  "approvedReferences": [],
  "legacyBehaviorSources": [],
  "protected": [],
  "validations": []
}
```

An approved reference requires `route`, `implementation`, `figmaUrl`, and `approvedByUser: true`. A `validated` target requires non-empty `visualEvidence` and `businessEvidence`. Recursively reject keys matching `password`, `token`, `cookie`, `secret`, or `authorization`, case-insensitively. Write through a sibling temporary file and `os.replace`.

- [ ] **Step 4: Pass migration-state tests**

Run: `python -m pytest tests/test_migration.py -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit migration state support**

```bash
git add src/figma_context_bridge/migration.py tests/test_migration.py examples/migration.json
git diff --cached --check
git commit -m "feat: add persistent figma migration state"
```

### Task 8: Agent-Friendly CLI and Legacy Pipeline

**Files:**
- Create: `src/figma_context_bridge/cli.py`
- Create: `tests/test_cli.py`
- Modify: `scripts/figma_pipeline.py`
- Modify: `README.md`
- Modify: `requirements.txt`

**Interfaces:**
- Consumes all earlier Core interfaces.
- Produces console command `figma-context` and stable JSON envelope `{ok, command, status, data, diagnostics}`.

- [ ] **Step 1: Write failing CLI contract tests**

Write six CLI tests by calling `main(argv)` directly. Monkeypatch Core handlers and assert: JSON mode emits one parseable object; partial prepare exits 0 with `status == "partial"`; invalid validation exits 20; status succeeds with `FIGMA_TOKEN` absent; migration validation exits 30 for a secret field; and the legacy pipeline invokes render after a partial prepare result.

- [ ] **Step 2: Verify CLI tests fail**

Run: `python -m pytest tests/test_cli.py -v`

Expected: FAIL because CLI handlers are missing.

- [ ] **Step 3: Implement subcommands and exit codes**

Implement:

```text
figma-context prepare URL --output DIR [--format png|jpg|svg] [--scale N] [--force] [--json]
figma-context inspect PACKAGE --json
figma-context validate-package PACKAGE --json
figma-context render PACKAGE [--output FILE] [--compare] --json
figma-context status PACKAGE --json
figma-context migration init TARGET_DIR --json
figma-context migration validate TARGET_DIR --json
```

Exit codes: `0` for complete or usable partial results, `20` invalid package, `30` invalid input, `40` missing/auth Token, `50` Figma API failure, and `60` filesystem failure. JSON mode catches typed errors and emits exactly one JSON object to stdout; human progress goes to stderr.

- [ ] **Step 4: Update legacy pipeline and documentation**

`scripts/figma_pipeline.py` calls Core APIs rather than spawning a subprocess with the Token in command arguments. It renders both `complete` and `partial` packages, displays missing assets for partial results, and opens the generated HTML only after render succeeds.

README documents editable installation, new commands, package status, the multimodal-Agent boundary, and the legacy command compatibility. Keep `requests>=2.31` in runtime dependencies; add pytest only under the test extra.

- [ ] **Step 5: Run the full offline verification suite**

Run:

```bash
python -m pytest -v
figma-context validate-package downloads/RPTaoLvpTfNZ5Gx7bYRvb8_1010-6349 --json
figma-context render downloads/RPTaoLvpTfNZ5Gx7bYRvb8_1010-6349 --output /tmp/figma-context-final.html --json
git diff --check
```

Expected: all tests PASS; cached package validation returns `complete` or `partial`; render returns `ok: true`; no diff errors.

- [ ] **Step 6: Commit the CLI delivery**

```bash
git add src/figma_context_bridge/cli.py scripts/figma_pipeline.py tests/test_cli.py README.md requirements.txt
git diff --cached --check
git commit -m "feat: expose agent-friendly figma context cli"
```

## Final Release Gate

- [ ] Run `python -m pytest -v` and record the pass count.
- [ ] Run all three legacy scripts with `--help` and verify exit code 0.
- [ ] Run `figma-context --help` and every read-only subcommand against a cached package.
- [ ] Verify a failed staged download leaves the previous cached package byte-for-byte intact.
- [ ] Verify JSON output contains no Figma Token or signed asset URLs.
- [ ] Verify `git status --short` contains only the intended task changes before each commit.
