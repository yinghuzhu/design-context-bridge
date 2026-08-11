# Multi-Target Design Replicate Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Codex and Claude Code accept natural-language or optional Markdown batch requests, confirm explicit design-to-system mappings, and independently implement and validate page or fragment units through the schema-v2 CLI.

**Architecture:** Keep the user-facing interface conversational: the Skill extracts candidate units, asks only for missing or ambiguous business facts, renders one concise execution contract, and generates internal CLI JSON after confirmation. References and evals enforce bounded repository analysis, single-URL package preparation, per-unit evidence, partial success, human acceptance separation, and zero target-repository pollution.

**Tech Stack:** Open Agent Skills Markdown, Codex/Claude Code, schema-v2 `design-context` CLI from `docs/superpowers/plans/2026-08-11-multi-target-migration-core-cli.md`, Vitest contract tests, JSON eval fixtures, optional Playwright MCP.

## Global Constraints

- Implement the approved design in `docs/plans/2026-08-11-multi-target-replication-batches-design.md`.
- Complete the Core/CLI plan before enabling new Skill commands.
- Default human input is natural language; users must never be required to write migration JSON.
- The Markdown batch template is optional and human-friendly; it is not a second persistence schema.
- Do not implement a CLI TTY wizard.
- Do not scan the full repository, component library, or Git history to infer mappings.
- One unit maps one logical design source to one system location/state; the same design in two locations creates two units.
- Units pass, block, and receive human acceptance independently; a blocked unit must not stop unrelated units.
- CLI remains deterministic and non-visual; only a multimodal Agent may judge screenshots.
- Generated state, packages, source JSON, screenshots, and evidence remain outside the target repository by default.
- Do not execute `git add -A`, modify a target `.gitignore`, or mark human acceptance without explicit user confirmation.
- Do not commit or push without explicit authorization. Gated commit steps must be skipped when authorization is absent.

---

## File Structure

- Modify `skills/design-replicate/SKILL.md`: concise hard gates and multi-unit workflow routing.
- Modify `skills/design-replicate/agents/openai.yaml`: natural-language multi-target description/default prompt.
- Modify `skills/design-replicate/references/input-contract.md`: conversational intake, information provenance, adaptive clarification, execution contract, and bounded analysis.
- Modify `skills/design-replicate/references/migration.md`: schema v2, batch/unit state, partial completion, acceptance, continuation, and v1 upgrade.
- Modify `skills/design-replicate/references/context-package.md`: distinct-source prepare loop, package reuse, fingerprint binding, and per-unit failure behavior.
- Modify `skills/design-replicate/references/validation.md`: target-type screenshot rules, unit evidence, business gates, partial handoff, and staged-file protection.
- Modify `skills/design-replicate/references/browser-auth.md`: host route plus activation behavior for fragments/flows.
- Create `skills/design-replicate/templates/batch-input.md`: optional human batch template.
- Create `skills/design-replicate/examples/multi-target-batch.md`.
- Create `skills/design-replicate/examples/fragment-target.md`.
- Create `skills/design-replicate/examples/partial-batch.md`.
- Create `skills/design-replicate/examples/markdown-batch.md`.
- Modify existing `skills/design-replicate/examples/*.md` for schema-v2 terminology and commands.
- Modify `README.md` and `docs/design.md` for user onboarding and architecture.
- Modify `test/skill-contract.test.ts`, `test/eval-contract.test.ts`, `test/install-skill.test.ts`, `test/repository-install.test.ts`.
- Modify `evals/design-replicate/cases.json`, add four fixtures, add four expected reports, and update `evals/design-replicate/README.md`.

---

### Task 1: Define conversational intake and optional Markdown batch input

**Files:**
- Modify: `skills/design-replicate/references/input-contract.md`
- Create: `skills/design-replicate/templates/batch-input.md`
- Modify: `test/skill-contract.test.ts`
- Modify: `test/install-skill.test.ts`

**Interfaces:**
- Consumes: user prompt, applicable project instructions, and bounded external migration state.
- Produces: confirmed candidate unit mappings and internal batch JSON; the user never supplies CLI schema fields.

- [ ] **Step 1: Add failing Skill contract tests for natural-language intake**

Add this test block:

```ts
it('uses natural language intake with adaptive clarification and one execution contract', async () => {
  const input = await text('references/input-contract.md');

  for (const phrase of [
    '自然语言', '执行契约', '信息来源', '用户明确指定',
    '适用项目说明', '外部 migration state', 'Agent 推断', '待确认',
    '只暂停该候选', '不得要求用户填写 migration JSON',
  ]) expect(input).toContain(phrase);
  expect(input).toContain('只有一两个信息缺失');
  expect(input).toContain('多个 unit');
  expect(input).toContain('确认前不得扫描或修改目标仓库');
});
```

- [ ] **Step 2: Add a failing template contract test**

```ts
it('ships an optional human-friendly Markdown batch template', async () => {
  const template = await text('templates/batch-input.md');

  for (const heading of ['# Design replication batch', '## Batch', '## Unit']) expect(template).toContain(heading);
  for (const field of ['Name:', 'Target repository:', 'Design URL:', 'System target:', 'Change:', 'Activation:', 'Scope:']) expect(template).toContain(field);
  for (const internal of ['revision:', 'packageFingerprint:', 'runtimeLocator:', 'visualEvidence:', 'businessEvidence:']) expect(template).not.toContain(internal);
});
```

Extend the `sourceSkill()` fixture with `templates/batch-input.md`, then assert the template is copied into both installed Skills and no template file is written into a target business repository.

- [ ] **Step 3: Run the focused tests and verify failure**

```bash
npx vitest run test/skill-contract.test.ts test/install-skill.test.ts
```

Expected: FAIL because the template and intake contract do not exist.

- [ ] **Step 4: Rewrite the input contract around business-language facts**

Require these user-level facts per candidate unit:

```markdown
- design-platform URL
- named system page, feature, host area, or runtime entry
- new or refactor
- how the target is reached or activated
- approved completed references, explicitly none when absent
- protected business behavior, explicitly none when absent
- explicit visual/implementation scope
```

State that the Agent generates IDs, target types, normalized URLs, dependency IDs, revisions, package fingerprints, runtime locators, implementation files, and evidence paths. It must never ask the user for those internal fields.

Document adaptive clarification:

1. one or two gaps -> one concise business question;
2. many gaps -> one table with `待确认` cells;
3. one ambiguous candidate -> pause only that candidate;
4. batch-wide reference/protection -> ask once, expand into units internally;
5. complete mapping -> display one execution contract and wait for confirmation.

- [ ] **Step 5: Add the complete optional Markdown template**

Use this exact structure in `skills/design-replicate/templates/batch-input.md`:

```markdown
# Design replication batch

This template is optional. Natural-language requests remain the default.

## Batch

- Name:
- Target repository:
- Common approved references: none
- Common protected behavior: none

## Unit

- Name:
- Design URL:
- System target:
- Change: new | refactor
- Activation:
- Scope:
- Approved references: inherit | none | describe
- Protected behavior: inherit | none | describe

## Unit

- Name:
- Design URL:
- System target:
- Change: new | refactor
- Activation:
- Scope:
- Approved references: inherit | none | describe
- Protected behavior: inherit | none | describe
```

Add instructions that the Agent must parse, show the execution contract, and obtain confirmation before generating internal JSON. The Markdown file must never be copied into the target repository by the Skill.

- [ ] **Step 6: Run intake/template/install tests**

```bash
npx vitest run test/skill-contract.test.ts test/install-skill.test.ts
```

Expected: PASS for the new intake and template tests; unrelated old single-page assertions may still fail until Task 2.

- [ ] **Step 7: Gated checkpoint**

Run `git diff --check`. If explicit commit authorization exists, commit only Task 1 files as `docs: add conversational batch intake`; otherwise leave uncommitted.

---

### Task 2: Update the Skill entrypoint and migration workflow for batches and units

**Files:**
- Modify: `skills/design-replicate/SKILL.md`
- Modify: `skills/design-replicate/agents/openai.yaml`
- Modify: `skills/design-replicate/references/migration.md`
- Modify: `skills/design-replicate/references/context-package.md`
- Modify: `test/skill-contract.test.ts`

**Interfaces:**
- Consumes: confirmed execution contract and schema-v2 CLI commands.
- Produces: per-unit preparation, implementation, mutation, partial completion, and continuation behavior.

- [ ] **Step 1: Replace single-page assertions with multi-unit hard-gate assertions**

Update the Skill contract to require all of these phrases/commands:

```ts
for (const required of [
  'batch', 'unit', '自然语言', '执行契约', 'templates/batch-input.md',
  'page', 'modal', 'tab', 'form', 'section',
  'design-context migration batch apply',
  'design-context migration unit update',
  'design-context migration reference update',
  'design-context migration inspect',
  '通过几个算几个', '人工验收', '--confirmed-by-user',
]) expect(skill).toContain(required);
```

Continue requiring multimodal capability, external workspace, Playwright MCP fallback, bounded analysis, visual/business gates, staged-file inspection, and no `git add -A`.

- [ ] **Step 2: Add failing migration-reference assertions**

```ts
it('defines schema-v2 batches, independent units, and acceptance', async () => {
  const migration = await text('references/migration.md');
  for (const phrase of [
    'schema v2', 'batches', 'units', 'dependsOn', 'packageFingerprint',
    'pending', 'in_progress', 'implemented', 'validated', 'blocked',
    'acceptance', 'accepted', 'rejected', 'partial', 'validationHistory',
    'migration upgrade', 'legacy_mapping_required',
  ]) expect(migration).toContain(phrase);
});
```

- [ ] **Step 3: Add failing package-loop assertions**

Require the context reference to state:

- prepare once per distinct canonical design source;
- same package may be reused by multiple units;
- package failure blocks only referencing units;
- manifest `contentFingerprint` is bound to each validated unit;
- changed content fingerprint reopens every unit using the old version, while request/cache fingerprint alone never proves a design change;
- `prepare` remains single URL and there is no `prepare-batch` command.

- [ ] **Step 4: Run the Skill contract and verify failure**

```bash
npx vitest run test/skill-contract.test.ts
```

Expected: FAIL against the single-page workflow.

- [ ] **Step 5: Rewrite the Skill hard gate and workflow**

Keep `SKILL.md` below 500 lines. The hard gate must:

1. verify multimodal ability;
2. accept natural language or optional Markdown;
3. extract candidate units from user/project/external state facts;
4. ask only for missing/ambiguous business facts;
5. present one execution contract;
6. wait for confirmation before repository analysis or batch apply.

The workflow must then:

```text
workspace resolve -> migration validate/inspect -> user confirms the execution contract
-> prepare each distinct URL + bounded approved-reference inspection
-> confirmed reference update -> batch apply -> block only units whose package failed
-> process remaining units in dependency order
-> unit update start/implemented/validated or blocked
-> per-unit human handoff -> accept only with explicit user confirmation
```

State explicitly that batch definitions never carry runtime status, evidence, acceptance, runtime locator, or implementation files. Successful prepare results supply canonical design bindings; a syntactically valid source whose download fails is registered with a null package binding and only its consuming units are blocked. A malformed/unparseable design URL stays in clarification and is not persisted as a valid unit. A blocked unit does not stop unrelated units, and the final report separates ready-for-review, blocked, and pending units.

- [ ] **Step 6: Rewrite migration and context-package references**

Document the exact schema-v2 statuses, separate acceptance (including rejected rework and rejected batch-summary precedence), approved unit/existing references, immutable reference IDs, revoke-and-create replacement, revoked-reference consumer blocking, batch summary, continuation command, same-design/two-location split, dependency invalidation, v1 explicit definition/index upgrade with revalidation, and no direct `migration.json` edits. Document content-fingerprint binding, request/cache fingerprint distinction, and single-source prepare semantics.

- [ ] **Step 7: Update OpenAI Skill metadata**

Use human-facing metadata:

```yaml
interface:
  display_name: "Design Replicate"
  short_description: "用自然语言批量复刻设计页面、弹窗、Tab、表单和局部组件，并逐项完成视觉与业务验证"
  default_prompt: "Use $design-replicate to extract and confirm the requested design-to-system mappings, then implement and validate each confirmed unit independently."
```

- [ ] **Step 8: Run the Skill contract**

```bash
npx vitest run test/skill-contract.test.ts
```

Expected: PASS for entrypoint, migration, and package workflow assertions.

- [ ] **Step 9: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 2 as `docs: define multi-target replicate workflow`; otherwise do not commit.

---

### Task 3: Define fragment capture, per-unit evidence, and partial validation

**Files:**
- Modify: `skills/design-replicate/references/browser-auth.md`
- Modify: `skills/design-replicate/references/validation.md`
- Create: `skills/design-replicate/examples/multi-target-batch.md`
- Create: `skills/design-replicate/examples/fragment-target.md`
- Create: `skills/design-replicate/examples/partial-batch.md`
- Create: `skills/design-replicate/examples/markdown-batch.md`
- Modify: `skills/design-replicate/examples/new-page.md`
- Modify: `skills/design-replicate/examples/initial-migration.md`
- Modify: `skills/design-replicate/examples/continuation.md`
- Modify: `skills/design-replicate/examples/adoption.md`
- Modify: `test/skill-contract.test.ts`

**Interfaces:**
- Consumes: target type, host route/runtime entry, activation, scope, protected behavior, and external evidence directory.
- Produces: comparable source/actual evidence and independent unit status updates.

- [ ] **Step 1: Add failing target-type validation assertions**

```ts
it('captures pages and fragments with different evidence scopes', async () => {
  const validation = await text('references/validation.md');
  for (const type of ['page', 'modal', 'drawer', 'tab', 'form', 'section', 'component', 'flow']) expect(validation).toContain(`\`${type}\``);
  for (const phrase of ['目标区域截图', '宿主上下文截图', 'hostRoute', 'activation', 'actual-context.png', '局部设计']) expect(validation).toContain(phrase);
  expect(validation).toContain('不得要求整个宿主页面匹配');
});
```

Add assertions for `evidence/batches/<batchId>/<unitId>/run-`, per-unit visual/business evidence, package fingerprint, no high/medium differences, partial handoff, and unrelated-unit continuation.

- [ ] **Step 2: Add failing browser activation assertions**

Require the browser reference to define route/runtime entry, activation execution, element/region capture, full context capture, flow checkpoints, current browser then Playwright MCP fallback, documented login, and MFA/CAPTCHA handoff.

- [ ] **Step 3: Run the contract and verify failure**

```bash
npx vitest run test/skill-contract.test.ts
```

Expected: FAIL because validation is page-only.

- [ ] **Step 4: Implement the target-type evidence matrix**

Document this exact matrix:

```markdown
| Target | Primary visual evidence | Context/business evidence |
|---|---|---|
| page | viewport or full-page screenshot | route, console, responsive state |
| modal/drawer | overlay container screenshot | host screenshot including trigger state |
| tab | active tab panel screenshot | host screenshot and tab interaction |
| form/section | bounded region screenshot | host layout and relevant validation |
| component | actual host or trusted harness screenshot | integration/console check |
| flow | final designed state screenshot | activation steps and protected-flow checks |
```

If the design contains backdrop or surrounding layout, include it in scope. If it is standalone, compare only the target region. Always save a context screenshot for fragments.

- [ ] **Step 5: Implement per-unit validation and handoff rules**

Require non-empty implementation files before `mark-implemented`; every non-page unit must also have a reproducible semantic runtime locator. Require current package fingerprint, source screenshot, actual screenshot, visual findings, business results, safe evidence paths, and target-specific tests before `mark-validated`. Report validated, blocked, and pending units independently. Human acceptance remains pending until the user responds.

- [ ] **Step 6: Add four complete examples**

Every example must contain user prompt, extracted execution contract, allowed reads, forbidden reads, CLI sequence, per-unit evidence, state changes, and final report conditions:

- `multi-target-batch.md`: page + modal + tab; new/refactor mixed.
- `fragment-target.md`: standalone Figma modal mapped to an existing page overlay; compare modal region plus host context.
- `partial-batch.md`: one validated, one business-blocked, one pending; validated unit is handed off.
- `markdown-batch.md`: parse optional template, mark inferred fields, confirm, then generate internal JSON.

Update the four existing examples from single target records to one-unit batches without changing their intended migration modes.

- [ ] **Step 7: Update Skill routing and run tests**

Add all template/example paths to `SKILL.md`, update the exact reference/example list assertion, then run:

```bash
npx vitest run test/skill-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 3 as `docs: add fragment and partial batch validation`; otherwise do not commit.

---

### Task 4: Add multi-target forward evals

**Files:**
- Modify: `evals/design-replicate/cases.json`
- Create: `evals/design-replicate/fixtures/natural-language-multi-target.json`
- Create: `evals/design-replicate/fixtures/markdown-batch-input.json`
- Create: `evals/design-replicate/fixtures/fragment-modal-target.json`
- Create: `evals/design-replicate/fixtures/partial-batch-progress.json`
- Create: `evals/design-replicate/expected/natural-language-multi-target.md`
- Create: `evals/design-replicate/expected/markdown-batch-input.md`
- Create: `evals/design-replicate/expected/fragment-modal-target.md`
- Create: `evals/design-replicate/expected/partial-batch-progress.md`
- Modify: `evals/design-replicate/README.md`
- Modify: `test/eval-contract.test.ts`

**Interfaces:**
- Consumes: installed Skill behavior.
- Produces: provider-neutral scenario contracts usable for Codex and Claude Code forward evaluation.

- [ ] **Step 1: Extend the eval schema for batches**

Update the TypeScript interface and every existing case to add:

```ts
interface EvalUnitExpectation {
  id: string;
  designUrl: string;
  targetType: 'page' | 'modal' | 'drawer' | 'tab' | 'form' | 'section' | 'component' | 'flow';
  changeType: 'new' | 'refactor';
  expectedOutcome: 'pending' | 'validated' | 'blocked';
}

interface EvalCase {
  name: string;
  fixture: string;
  provider: string | null;
  designUrl: string | null;
  prompt: string;
  expectedReads: string[];
  forbiddenReads: string[];
  expectedCommands: string[];
  expectedState: Record<string, unknown>;
  expectedUnits: EvalUnitExpectation[];
  completionAllowed: boolean;
}
```

Single-target legacy cases contain one expected unit; missing-input/non-multimodal preparation cases may use an empty array.

- [ ] **Step 2: Add failing scenario-set assertions**

Require the four new case names and assert:

- natural-language case has page, modal, and tab units;
- Markdown case requires execution-contract confirmation before batch apply;
- fragment case requires target-region plus context screenshot and forbids full-host visual equivalence;
- partial case contains validated and blocked outcomes and permits handoff only for the validated unit.

- [ ] **Step 3: Run eval contracts and verify failure**

```bash
npx vitest run test/eval-contract.test.ts
```

Expected: FAIL because cases lack `expectedUnits` and new fixtures.

- [ ] **Step 4: Add the four fixtures**

Each fixture must be synthetic and provider-neutral beyond its declared Figma URLs. Include only named route/component/API/test metadata required by the scenario; do not include secrets or a full fake repository index.

The natural-language prompt should resemble:

```text
在 ./project 改造个人中心：URL A 是订单列表页，URL B 是点击筛选打开的弹窗，URL C 是订单详情退款 Tab。A/C 改造，B 新增；参考 /checkout；订单 API、分页和退款流程不变。
```

The partial case must make one business test fail while another unit fully passes.

- [ ] **Step 5: Add expected reports**

Every report retains existing headings:

```markdown
## 允许行为
## 禁止行为
## 最终报告条件
```

Additionally require `## 执行契约` and `## Unit 结果`. Explicitly forbid automatic acceptance, whole-repository scans, direct migration JSON edits, package visual scoring, and staged generated evidence.

- [ ] **Step 6: Update the eval runbook and tests**

Document how reviewers judge mapping confirmation, distinct package preparation, fragment capture, per-unit state, partial handoff, and repository cleanliness for both Codex and Claude Code.

Run:

```bash
npx vitest run test/eval-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 4 as `test: add multi-target replicate evals`; otherwise do not commit.

---

### Task 5: Update team documentation and installed Skill acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `test/repository-install.test.ts`
- Modify: `test/skill-contract.test.ts`

**Interfaces:**
- Consumes: completed Core/CLI and Skill behavior.
- Produces: team-facing natural-language onboarding, optional Markdown workflow, and installed artifact proof.

- [ ] **Step 1: Add failing README/architecture assertions**

In `test/repository-install.test.ts`, require README content for:

```ts
for (const required of [
  '自然语言', '多个设计目标', '页面、弹窗、Tab、表单和局部区域',
  'skills/design-replicate/templates/batch-input.md',
  'migration batch apply', 'migration unit update', 'migration reference update', 'migration inspect',
  '通过几个算几个', '工具验证', '人工验收',
]) expect(readme).toContain(required);
```

Require `docs/design.md` to describe the conversational intake layer, schema-v2 state layer, deterministic package layer, and multimodal validation layer.

- [ ] **Step 2: Run documentation/install tests and verify failure**

```bash
npx vitest run test/repository-install.test.ts test/skill-contract.test.ts
```

Expected: FAIL because team documentation is still single-page.

- [ ] **Step 3: Add a minimal natural-language onboarding example**

README must lead with a prompt users can copy:

```text
使用 $design-replicate 在当前仓库改造个人中心：
- <Figma URL A> 对应我的订单列表页，属于改造；
- <Figma URL B> 对应点击筛选后出现的弹窗，属于新功能；
- <Figma URL C> 对应订单详情的退款 Tab，属于改造。
可以参考 /checkout；订单 API、分页、筛选参数和退款流程不能改变。
```

Then show the optional Markdown template path for larger batches. State that the Agent extracts and confirms mappings; users do not write JSON or run state mutation commands manually.

- [ ] **Step 4: Update architecture documentation**

Document the layered flow:

```text
natural language or optional Markdown
-> Skill extraction/clarification/confirmation
-> internal batch JSON
-> deterministic CLI validation and external state
-> single-source packages
-> bounded implementation
-> multimodal per-unit validation
-> explicit human acceptance
```

Clarify that CLI remains non-interactive and non-visual.

- [ ] **Step 5: Extend installed Skill smoke assertions**

After repository installation, assert both Codex and Claude Skill copies include `templates/batch-input.md`, the four new examples, and schema-v2 references. Keep the real temporary target repository status empty.

- [ ] **Step 6: Run all Skill/document/eval tests**

```bash
npx vitest run test/skill-contract.test.ts test/eval-contract.test.ts test/install-skill.test.ts test/repository-install.test.ts
```

Expected: PASS.

- [ ] **Step 7: Gated checkpoint**

Run `git diff --check`. If explicitly authorized, commit Task 5 as `docs: publish multi-target team workflow`; otherwise do not commit.

---

### Task 6: Full regression and zero-pollution review

**Files:**
- Modify only files required by regressions caused by this plan.

**Interfaces:**
- Consumes: all Core/CLI and Skill tasks.
- Produces: final uncommitted acceptance evidence unless separate commit/push authorization is provided.

- [ ] **Step 1: Run the complete project gate**

```bash
npm run check
```

Expected: secret scan, typecheck, lint, all tests, and build PASS.

- [ ] **Step 2: Verify installed Markdown and Skill contents**

Run the repository installer against disposable `--home`, `--install-root`, and `--bin-dir` paths. Verify both Agent installations contain the template, references, and examples; verify `design-context --version` succeeds.

- [ ] **Step 3: Run an isolated multi-unit repository smoke test**

Create a `mktemp` Git repository and isolated state/cache roots. Exercise one page unit to validated and one modal unit to blocked through the installed CLI. Store batch input and evidence only beneath the temporary root outside the Git repository.

Run:

```bash
git -C "$TARGET_DIR" status --porcelain
```

Expected: empty output; no `.design-context`, screenshots, JSON inputs, Playwright reports, or evidence under the target repository.

- [ ] **Step 4: Review generated-file staging protection**

In a disposable repository, stage a synthetic `.design-context/evidence/actual.png`, confirm the Skill contract requires stopping on `git diff --cached --name-only`, then unstage/remove only the synthetic disposable file. Do not perform this check in a real business repository.

- [ ] **Step 5: Self-review the complete spec coverage**

Check every section of `docs/plans/2026-08-11-multi-target-replication-batches-design.md` against a Core/CLI or Skill task. Run:

```bash
rg -n "T[B]D|T[O]DO|implement[ ]later|add[ ]appropriate|similar[ ]to" \
  docs/superpowers/plans/2026-08-11-multi-target-migration-core-cli.md \
  docs/superpowers/plans/2026-08-11-multi-target-design-replicate-skill.md
git diff --check
git status --short
```

Expected: no placeholders, no whitespace errors, and only intended uncommitted files.

- [ ] **Step 6: Gated delivery**

Do not commit or push without explicit authorization. If authorization is later provided, inspect `git diff --cached --name-only`, ensure generated files are absent, stage only reviewed implementation/docs/tests, rerun `npm run check`, and then commit/push exactly as authorized.
