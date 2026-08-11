# Design Source Scope Gate Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD. No subagent is required for this scoped change.

**Goal:** Prevent a Figma leaf background primitive from being treated as a complete implementation source while preserving legitimate image, vector, component, and instance roots.

**Architecture:** A provider-neutral deterministic analyzer derives `design_scope_suspicious` from normalized `design.json`. Package creation persists the diagnostic, package validation recomputes and deduplicates it for old caches, and the Skill applies the semantic/multimodal hard gate before repository reads or edits.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, Markdown Skill contracts, JSON forward-eval descriptors.

## Global Constraints

- CLI does not perform image recognition, visual scoring, or final visual acceptance.
- Generated packages and evidence remain outside target repositories by default.
- The diagnostic is non-retryable because refreshing the same node cannot repair a wrong selection.
- Do not silently replace the user-supplied node with a parent or sibling.
- Do not commit or push without explicit user authorization.

---

### Task 1: Deterministic low-information root diagnosis

**Files:**
- Modify: `src/core/package.ts`
- Modify: `src/core/downloader.ts`
- Test: `test/package.test.ts`
- Test: `test/downloader.test.ts`

**Interfaces:**
- Produces: `diagnoseDesignScope(document: DesignDocument): Diagnostic[]`
- Consumes: normalized `DesignDocument` and existing `Diagnostic`/`PackageValidation` models.

- [x] Add failing validator coverage for a cached `complete` package whose root is an asset-free leaf `RECTANGLE`; expect `partial` and one `design_scope_suspicious` diagnostic.
- [x] Add failing downloader coverage for the same normalized source; expect the manifest and returned validation to be `partial` without duplicate diagnostics.
- [x] Add a negative test showing a leaf rectangle with `assetRef` remains `complete`.
- [x] Implement `diagnoseDesignScope` with the exact primitive allow-list and stable, credential-free message.
- [x] Merge the analyzer output into downloader diagnostics before manifest status is chosen.
- [x] Recompute and deduplicate analyzer diagnostics in `validatePackage` so matching old caches cannot bypass the gate.
- [x] Run `npx vitest run test/package.test.ts test/downloader.test.ts` and expect all tests to pass.

### Task 2: Skill source-to-target semantic gate

**Files:**
- Modify: `skills/design-replicate/SKILL.md`
- Modify: `skills/design-replicate/references/context-package.md`
- Modify: `skills/design-replicate/references/input-contract.md`
- Modify: `skills/design-replicate/references/validation.md`
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `CHANGELOG.md`
- Test: `test/skill-contract.test.ts`

**Interfaces:**
- Consumes: `design_scope_suspicious` returned by prepare or validate-package.
- Produces: a mandatory pre-repository multimodal scope check and actionable correction message.

- [x] Add failing contract assertions for the diagnostic code, non-retryable behavior, pre-repository gate, screenshot-to-user-description comparison, no silent parent selection, and current-unit-only blocking.
- [x] Update the Skill workflow so package scope is verified before target repository reads or edits.
- [x] Document the user recovery action: select the containing Frame/Group/Section/Component and copy the selected-node link.
- [x] Document explicit primitive-only confirmation as the narrow exception.
- [x] Update README, technical design, and changelog package status and Agent workflow descriptions.
- [x] Run `npx vitest run test/skill-contract.test.ts` and expect all tests to pass.

### Task 3: Cross-Agent regression scenario and release checks

**Files:**
- Modify: `evals/design-replicate/cases.json`
- Create: `evals/design-replicate/fixtures/design-scope-mismatch.json`
- Create: `evals/design-replicate/expected/design-scope-mismatch.md`
- Modify: `test/eval-contract.test.ts`

**Interfaces:**
- Produces: forward-eval case `design-scope-mismatch` with completion forbidden and zero target implementation reads.

- [x] Add the fixture with a simulated `partial` package, `design_scope_suspicious`, a leaf rectangle summary, and a visually blank source screenshot.
- [x] Add the expected report requiring the Agent to stop before repository implementation access and request a containing-node URL.
- [x] Add the case contract with only workspace/prepare/validate/inspect commands and `completionAllowed: false`.
- [x] Extend eval contract assertions for `sourceScope: blocked` and an empty `expectedReads` list.
- [x] Run `npx vitest run test/eval-contract.test.ts` and expect all tests to pass.
- [x] Run `npm run check`, `git diff --check`, `git diff --cached --name-only`, and `git status --short`; expect checks to pass, staged output to be empty, and only authorized source/docs/test changes to remain unstaged.
