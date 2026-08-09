# Multimodal Figma Replication Skill Implementation Plan

> Historical implementation record. This completed Figma-specific plan is non-normative; use `skills/design-replicate/` and the repository README for current behavior.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 Codex、Claude Code 通用的 `figma-replicate` Skill，让多模态 Agent 在用户明确范围后调用 `figma-context` CLI，完成有界分析、页面实施、视觉迭代、业务验证和人工验收交接。

**Architecture:** Skill 只承载工作流、决策和质量门禁，确定性能力由 `figma-context` CLI 提供。主 `SKILL.md` 保持精简，通过 references 渐进加载输入契约、迁移模式、浏览器登录和验证规则；目标项目的 `.figma-context/` 保存用户确认的跨会话事实。

**Tech Stack:** Open Agent Skills `SKILL.md`、Markdown references、Python 3.10+ 安装器与静态契约测试、Codex、Claude Code、可选 Playwright MCP

## Global Constraints

- 必须先完成 `docs/superpowers/plans/2026-08-07-figma-context-core-cli.md`。
- 完整设计以 `docs/plans/2026-08-07-agent-figma-replication-design.md` 为准。
- 完整复刻只允许具备图片理解能力的多模态 Agent 执行。
- 用户未提供目标页面和对应 Figma URL 时，禁止开始仓库分析或修改。
- 迁移模式下，只有用户、项目说明或 `.figma-context/` 明确确认的页面才能作为新版参考。
- 禁止无界扫描仓库；只读取目标、指定参考和必要直接依赖。
- Skill 可以调用外部 Playwright MCP，但本项目不实现 MCP 或 HTTP 服务。
- CLI 不承担视觉判断；多模态 Agent 对比原稿和真实运行截图。
- 如果修改可能影响交互或既有业务流程，必须验证后才能通知人工验收。
- 不打印、记录或提交密码、Token、Cookie、Authorization header。
- 本项目忽略 Java 和 MySQL 规范。
- 每个任务提交前运行 `git diff --check`。

---

## Planned File Map

| File | Responsibility |
|---|---|
| `skills/figma-replicate/SKILL.md` | 触发条件、前置门禁、总流程和 reference 路由 |
| `skills/figma-replicate/references/input-contract.md` | 强制用户输入和有界依赖分析 |
| `skills/figma-replicate/references/context-package.md` | CLI 调用和设计上下文使用顺序 |
| `skills/figma-replicate/references/migration.md` | 三种迁移模式和 `.figma-context/` |
| `skills/figma-replicate/references/browser-auth.md` | 浏览器路径和最少人工干预登录策略 |
| `skills/figma-replicate/references/validation.md` | 多模态视觉循环、业务验证和完成门禁 |
| `skills/figma-replicate/examples/` | 四种工作模式示例 |
| `scripts/install_skill.py` | 安装到 Codex、Claude Code 或两者 |
| `tests/test_skill_contract.py` | Skill 文件、引用和强制规则静态测试 |
| `tests/test_install_skill.py` | 安装器测试 |
| `evals/figma-replicate/` | 两个 Agent 的场景化验收包 |

## Design Coverage Map

- 强制输入契约和有界依赖分析：Task 1、Task 2。
- 资产包生成、状态和失败恢复：前置 Core/CLI 计划的 Task 2、Task 4、Task 8，以及本计划 Task 3。
- initial、continuation、adoption 和跨会话状态：前置 Core/CLI 计划 Task 7，以及本计划 Task 4。
- 浏览器选择、项目说明登录、Playwright MCP 和用户接管：Task 5。
- 多模态视觉循环、业务回归和人工验收门禁：Task 5。
- Codex、Claude Code 分发和双客户端验证：Task 6、Task 7。
- 非目标 MCP、HTTP、CLI 图片识别和全仓库扫描：Global Constraints 和 Task 1 禁止项。

### Task 1: Portable Skill Skeleton and Hard Preconditions

**Files:**
- Create: `skills/figma-replicate/SKILL.md`
- Create: `tests/test_skill_contract.py`

**Interfaces:**
- Consumes: installed `figma-context` CLI and current Agent capabilities.
- Produces: skill name `figma-replicate` with explicit and implicit triggers.

- [ ] **Step 1: Write failing structure tests**

```python
from pathlib import Path


SKILL = Path("skills/figma-replicate/SKILL.md")


def test_skill_has_portable_frontmatter() -> None:
    text = SKILL.read_text(encoding="utf-8")
    assert text.startswith("---\nname: figma-replicate\n")
    assert "description:" in text.split("---", 2)[1]


def test_skill_enforces_multimodal_and_required_inputs() -> None:
    text = SKILL.read_text(encoding="utf-8")
    assert "多模态" in text
    assert "目标页面" in text
    assert "Figma URL" in text
    assert "不得开始仓库分析或修改" in text


def test_skill_routes_to_every_reference() -> None:
    text = SKILL.read_text(encoding="utf-8")
    names = ("input-contract.md", "context-package.md", "migration.md", "browser-auth.md", "validation.md")
    assert all(f"references/{name}" in text for name in names)
```

- [ ] **Step 2: Verify missing-file failure**

Run: `python -m pytest tests/test_skill_contract.py -v`

Expected: FAIL with `FileNotFoundError` for `SKILL.md`.

- [ ] **Step 3: Create the main Skill with the approved hard gates**

```markdown
---
name: figma-replicate
description: 使用 Figma URL 在新项目中创建页面，或按用户明确指定的目标、已完成新版参考和业务保护边界迁移已有前端页面；适用于需要多模态视觉复刻、浏览器截图迭代和业务回归验证的任务。
---

# Figma Replicate

## Hard gate

1. Confirm this Agent can inspect local images with multimodal vision. Otherwise stop replication; only context-package preparation is allowed.
2. Read applicable `AGENTS.md`, `CLAUDE.md`, `.figma-context/migration.json`, and directly named project instructions.
3. Require a target page or route and its Figma URL. For migration, require user-approved new-page references and protected business behavior. If those facts are absent, ask the user and不得开始仓库分析或修改.
4. Read `references/input-contract.md` and enforce bounded analysis.

## Workflow

1. Read `references/context-package.md`; prepare and validate the package with `figma-context`.
2. Select new, initial migration, continuation, or adoption using `references/migration.md`.
3. Inspect only the target, approved references, and necessary direct dependencies.
4. Preserve confirmed API, route, state, validation, error, and business boundaries.
5. Implement with the target repository's stack unless the user explicitly chooses another.
6. Read `references/browser-auth.md`; obtain a real target-page screenshot through an available browser path.
7. Read `references/validation.md`; compare source and actual screenshots using multimodal vision and iterate.
8. Run relevant interaction and business-flow checks.
9. Update `.figma-context/` only with user-confirmed or verified facts.
10. Notify human acceptance only after the completion gate passes.

## Source priority

Use `screenshot.png` as visual truth, `node.json` for exact geometry and text, `assets/` for original media, and `AI_CONTEXT.md` for navigation. Treat `reconstruct.html` only as auxiliary reference.

## Prohibitions

- Do not scan the full repository to guess new and old pages.
- Do not designate an unapproved page as a new-design reference.
- Do not claim visual acceptance without viewing both source and real running-page screenshots.
- Do not expose credentials or store them under `.figma-context/`.
```

- [ ] **Step 4: Pass and commit the skeleton tests**

```bash
python -m pytest tests/test_skill_contract.py -v
git add skills/figma-replicate/SKILL.md tests/test_skill_contract.py
git diff --cached --check
git commit -m "feat: add figma replication skill skeleton"
```

Expected: all current tests PASS.

### Task 2: Required Input and Bounded Analysis

**Files:**
- Create: `skills/figma-replicate/references/input-contract.md`
- Modify: `tests/test_skill_contract.py`

**Interfaces:**
- Produces: deterministic input contract and allowed dependency closure.

- [ ] **Step 1: Add the failing reference assertion**

```python
def test_input_contract_forbids_unbounded_discovery() -> None:
    text = Path("skills/figma-replicate/references/input-contract.md").read_text(encoding="utf-8")
    roles = ("target", "approved_reference", "legacy_behavior_source", "protected", "unknown")
    assert all(role in text for role in roles)
    assert "禁止默认遍历全部页面" in text
    assert "信息满足当前迁移后立即停止" in text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_skill_contract.py::test_input_contract_forbids_unbounded_discovery -v`

Expected: FAIL because the reference is absent.

- [ ] **Step 3: Write the exact contract**

The reference requires Figma URL, target directory, and target page/route for new work. Migration additionally requires user-approved completed new pages and protected behavior. It defines `target`, `approved_reference`, `legacy_behavior_source`, `protected`, and `unknown`; only the first four can affect implementation. It permits reading named routes/files, direct components, approved references, their reusable direct dependencies, and directly relevant API/store/validation/tests. It contains the exact rules “禁止默认遍历全部页面、完整组件库或全部 Git 历史” and “信息满足当前迁移后立即停止”.

- [ ] **Step 4: Pass tests and commit**

```bash
python -m pytest tests/test_skill_contract.py -v
git add skills/figma-replicate/references/input-contract.md tests/test_skill_contract.py
git diff --cached --check
git commit -m "docs: define bounded figma migration inputs"
```

Expected: all tests PASS.

### Task 3: Context Package Invocation

**Files:**
- Create: `skills/figma-replicate/references/context-package.md`
- Modify: `tests/test_skill_contract.py`

**Interfaces:**
- Consumes: Core CLI JSON envelope and package status.
- Produces: prepare, validate, inspect, and render command sequence.

- [ ] **Step 1: Add the failing CLI-reference test**

```python
def test_context_reference_uses_json_and_package_statuses() -> None:
    text = Path("skills/figma-replicate/references/context-package.md").read_text(encoding="utf-8")
    assert "figma-context prepare" in text
    assert "figma-context validate-package" in text
    assert all(status in text for status in ("complete", "partial", "invalid"))
    assert "FIGMA_TOKEN" in text
    assert "signed asset URL" in text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_skill_contract.py::test_context_reference_uses_json_and_package_statuses -v`

Expected: FAIL because the reference is absent.

- [ ] **Step 3: Write exact CLI usage and recovery rules**

The reference checks Token presence without printing it and runs:

```bash
figma-context prepare "$FIGMA_URL" --output "$CONTEXT_ROOT" --json
figma-context validate-package "$PACKAGE_DIR" --json
figma-context inspect "$PACKAGE_DIR" --json
```

`complete` continues. `partial` reads diagnostics, retries recoverable assets, and continues only when missing assets do not prevent implementation; visual validation stays mandatory. `invalid` stops before target-project modification. The Agent reads `AI_CONTEXT.md` first, then only relevant nodes, and never pastes full `node.json` or a signed asset URL into chat.

- [ ] **Step 4: Pass tests and commit**

```bash
python -m pytest tests/test_skill_contract.py -v
git add skills/figma-replicate/references/context-package.md tests/test_skill_contract.py
git diff --cached --check
git commit -m "docs: define agent context package workflow"
```

Expected: all tests PASS.

### Task 4: Migration Modes and Persistent State

**Files:**
- Create: `skills/figma-replicate/references/migration.md`
- Create: `skills/figma-replicate/examples/initial-migration.md`
- Create: `skills/figma-replicate/examples/continuation.md`
- Create: `skills/figma-replicate/examples/adoption.md`
- Modify: `tests/test_skill_contract.py`

**Interfaces:**
- Consumes: `.figma-context/migration.json` schema version 1.
- Produces: initial, continuation, and adoption routing without automatic page inference.

- [ ] **Step 1: Add the failing migration test**

```python
def test_migration_reference_requires_modes_and_user_approval() -> None:
    text = Path("skills/figma-replicate/references/migration.md").read_text(encoding="utf-8")
    assert all(f"`{mode}`" in text for mode in ("initial", "continuation", "adoption"))
    assert "approvedByUser" in text
    assert "新会话不等于新迁移" in text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_skill_contract.py::test_migration_reference_requires_modes_and_user_approval -v`

Expected: FAIL because the reference is absent.

- [ ] **Step 3: Write routing and state transitions**

Define `initial` as a legacy target without approved new implementation; `continuation` as a valid existing `.figma-context/`; and `adoption` as migration work predating this tool, where the user must name completed new pages. Read project instructions and validate state on every new conversation. Record `approved_reference` only after user or project-instruction confirmation, `implemented` after code exists, and `validated` only after visual and business evidence exist. Include “新会话不等于新迁移”.

- [ ] **Step 4: Add concrete examples**

Each example contains the user prompt, accepted input mapping, allowed files, forbidden scope expansion, state changes, evidence, and expected final report. The adoption example uses user-approved `/checkout` as reference and `/payment/result` as target without inspecting unrelated pages.

- [ ] **Step 5: Pass tests and commit**

```bash
python -m pytest tests/test_skill_contract.py -v
git add skills/figma-replicate/references/migration.md skills/figma-replicate/examples tests/test_skill_contract.py
git diff --cached --check
git commit -m "docs: define resumable figma migration modes"
```

Expected: all tests PASS.

### Task 5: Browser, Login, and Multimodal Validation

**Files:**
- Create: `skills/figma-replicate/references/browser-auth.md`
- Create: `skills/figma-replicate/references/validation.md`
- Create: `skills/figma-replicate/examples/new-page.md`
- Modify: `tests/test_skill_contract.py`

**Interfaces:**
- Produces: browser fallback, low-intervention login, visual iteration, regression gate, and handoff format.

- [ ] **Step 1: Add failing browser and validation tests**

```python
def test_browser_reference_has_fallback_and_safe_login() -> None:
    text = Path("skills/figma-replicate/references/browser-auth.md").read_text(encoding="utf-8")
    assert "Playwright MCP" in text
    assert "AGENTS.md" in text and "CLAUDE.md" in text
    assert "MFA" in text and "验证码" in text
    assert "不得输出" in text


def test_validation_requires_visual_and_business_gates() -> None:
    text = Path("skills/figma-replicate/references/validation.md").read_text(encoding="utf-8")
    assert "原稿截图" in text and "实际截图" in text
    assert "高、中优先级" in text
    assert "业务" in text and "人工验收" in text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_skill_contract.py -v`

Expected: FAIL because both references are absent.

- [ ] **Step 3: Write browser and login priority**

The browser reference defines: current Agent browser, then Playwright MCP independent browser, then target-project browser tests. Reuse a valid session first; read project instructions; use documented test accounts, scripts, seeds, storage state, or environment references; automate ordinary login. Ask the user only for MFA, CAPTCHA, enterprise SSO, missing authorization, or user-controlled identity steps. Never request or print credentials, and default to local/development/test environments unless production is explicitly authorized.

- [ ] **Step 4: Write validation and completion gate**

The validation reference requires equal target viewport/state screenshots and multimodal inspection of structure, geometry, spacing, typography, wrapping, colors, effects, layers, assets, clipping, and required states. The Agent records area, severity, expected, actual, likely cause, and evidence path, then patches and repeats until no high or medium issue remains. It then runs relevant build, type, console, interaction, API, state, validation, error, and protected-flow checks. Only after all gates pass may it update state and notify human acceptance with URL, screenshots, checks, and low-priority differences.

- [ ] **Step 5: Add example, pass tests, and commit**

```bash
python -m pytest tests/test_skill_contract.py -v
git add skills/figma-replicate/references/browser-auth.md skills/figma-replicate/references/validation.md skills/figma-replicate/examples/new-page.md tests/test_skill_contract.py
git diff --cached --check
git commit -m "docs: add multimodal figma validation workflow"
```

Expected: tests PASS and the example uses Agent vision rather than CLI image scoring.

### Task 6: Codex and Claude Code Installer

**Files:**
- Create: `scripts/install_skill.py`
- Create: `tests/test_install_skill.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `install_skill(source, home, clients, copy) -> list[Path]`.
- Installs to `$HOME/.agents/skills/figma-replicate` and `$HOME/.claude/skills/figma-replicate`.

- [ ] **Step 1: Write failing installer tests**

```python
from pathlib import Path

from scripts.install_skill import install_skill


def test_install_both_creates_client_links(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "SKILL.md").write_text("---\nname: figma-replicate\n---\n")
    installed = install_skill(source, tmp_path / "home", ("codex", "claude"), copy=False)
    assert installed == [tmp_path / "home/.agents/skills/figma-replicate", tmp_path / "home/.claude/skills/figma-replicate"]
    assert all(path.is_symlink() for path in installed)


def test_copy_mode_copies_references(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "references").mkdir(parents=True)
    (source / "SKILL.md").write_text("skill")
    (source / "references/rules.md").write_text("rules")
    installed = install_skill(source, tmp_path / "home", ("codex",), copy=True)
    assert (installed[0] / "references/rules.md").read_text() == "rules"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_install_skill.py -v`

Expected: FAIL because the installer is absent.

- [ ] **Step 3: Implement safe explicit installation**

```python
CLIENT_PATHS = {
    "codex": Path(".agents/skills/figma-replicate"),
    "claude": Path(".claude/skills/figma-replicate"),
}


def install_skill(source: Path, home: Path, clients: tuple[str, ...], copy: bool) -> list[Path]:
    if not (source / "SKILL.md").is_file():
        raise ValueError(f"Missing SKILL.md: {source}")
    installed = []
    for client in clients:
        destination = home / CLIENT_PATHS[client]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() or destination.is_symlink():
            raise FileExistsError(destination)
        if copy:
            shutil.copytree(source, destination)
        else:
            destination.symlink_to(source.resolve(), target_is_directory=True)
        installed.append(destination)
    return installed
```

The CLI accepts `--client codex|claude|both`, `--copy`, `--home`, and `--source`. It never overwrites an existing installation. README documents both install modes, explicit invocation, implicit triggers, Token, CLI prerequisite, multimodal requirement, and Playwright MCP fallback.

- [ ] **Step 4: Pass tests and commit**

```bash
python -m pytest tests/test_install_skill.py -v
git add scripts/install_skill.py tests/test_install_skill.py README.md
git diff --cached --check
git commit -m "feat: install figma skill for codex and claude"
```

Expected: all installer tests PASS.

### Task 7: Cross-Agent Evaluation Pack

**Files:**
- Create: `evals/figma-replicate/README.md`
- Create: `evals/figma-replicate/cases.json`
- Create: `evals/figma-replicate/expected/`
- Modify: `tests/test_skill_contract.py`

**Interfaces:**
- Produces: identical release-gate scenarios for Codex and Claude Code.

- [ ] **Step 1: Add failing evaluation-schema test**

```python
import json


def test_eval_pack_covers_required_scenarios() -> None:
    cases = json.loads(Path("evals/figma-replicate/cases.json").read_text())
    names = {case["name"] for case in cases}
    assert names == {
        "missing-required-input",
        "non-multimodal-agent",
        "new-page",
        "initial-migration",
        "continuation",
        "adoption-with-user-reference",
        "bounded-large-repository",
        "playwright-mcp-fallback",
        "documented-login",
        "mfa-user-handoff",
        "visual-pass-business-fail",
    }
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_skill_contract.py::test_eval_pack_covers_required_scenarios -v`

Expected: FAIL because the evaluation pack is absent.

- [ ] **Step 3: Create scenario records and expected reports**

Every case contains `name`, `fixture`, `prompt`, `expectedReads`, `forbiddenReads`, `expectedCommands`, `expectedState`, and `completionAllowed`. Add `expected/<name>.md` with the required final report. The large-repository case lists unrelated directories under `forbiddenReads`; the visual-pass-business-fail case sets `completionAllowed` to false.

- [ ] **Step 4: Write the two-client execution runbook**

The runbook gives exact commands to copy each fixture into a temporary directory, invoke Codex with `$figma-replicate`, invoke Claude Code with `/figma-replicate`, capture transcripts and accessed-path summaries, compare them with the case, and remove only the generated temporary fixture. Only the MFA case permits manual login; production credentials are forbidden.

- [ ] **Step 5: Pass tests and commit**

```bash
python -m pytest tests/test_skill_contract.py tests/test_install_skill.py -v
git add evals/figma-replicate tests/test_skill_contract.py
git diff --cached --check
git commit -m "test: add cross-agent figma skill evaluations"
```

Expected: all static tests PASS and every case has one expected report.

## Final Release Gate

- [ ] Run `python -m pytest -v` and record the pass count.
- [ ] Install the Skill into disposable homes in symlink and copy mode.
- [ ] Verify every relative reference from `SKILL.md` exists.
- [ ] Confirm missing input causes no repository scan or modification.
- [ ] Confirm a non-multimodal Agent cannot claim visual completion.
- [ ] Run new-page and all three migration modes in Codex and Claude Code.
- [ ] Confirm continuation reads `.figma-context/` rather than restarting.
- [ ] Confirm adoption uses only user-approved references.
- [ ] Confirm Playwright MCP works as independent-browser fallback.
- [ ] Confirm project-documented login is attempted before user interruption, while MFA hands control to the user without requesting credentials.
- [ ] Confirm visual success plus business failure blocks human-acceptance notification.
- [ ] Confirm final reports contain URLs, screenshots, checks, known low-priority differences, and no secrets.
