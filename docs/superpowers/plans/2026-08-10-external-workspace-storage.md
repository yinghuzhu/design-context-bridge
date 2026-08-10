# External Workspace Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure design-replicate writes all generated state, packages, and evidence outside target repositories by default.

**Architecture:** Add a workspace resolver that canonicalizes Git/non-Git targets and maps them to XDG-style external state/cache directories. Route migration and prepare through this resolver, retaining manual output only behind a realpath-aware in-repository safety gate.

**Tech Stack:** Node.js 20+, TypeScript, Git CLI, Vitest, existing source-provider registry and repository installer.

## Global Constraints

- Do not modify a real business project; all integration verification uses `mktemp` or test temporary directories.
- Do not commit or push without explicit authorization.
- Default commands must not create or modify `.design-context` in a target repository.
- Never persist credentials, cookies, authorization values, signed URLs, or passwords.
- Preserve provider, prepare, validate, inspect, render, and refresh behavior outside the intentional storage contract change.

---

### Task 1: Canonical workspace resolution

**Files:**
- Create: `src/core/workspace.ts`
- Modify: `src/index.ts`
- Create: `test/workspace.test.ts`

**Interfaces:**
- Produces: `resolveWorkspace(targetDirectory, options?)`, `resolveOutputLocation(outputDirectory)`, `WorkspacePaths`, and `StorageScope`.

- [ ] Write failing tests for Git root resolution, non-Git realpath fallback, relative/absolute/symlink identity, separate repositories, environment precedence, and symlink-safe containment.
- [ ] Run `npx vitest run test/workspace.test.ts` and verify the missing module/functions fail.
- [ ] Implement canonicalization through the nearest existing ancestor, `git rev-parse --show-toplevel`, SHA-256 IDs, and XDG root selection.
- [ ] Run `npx vitest run test/workspace.test.ts` and verify all workspace tests pass.

### Task 2: External migration state and legacy import

**Files:**
- Modify: `src/core/migration.ts`
- Modify: `test/migration.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspace()` from Task 1.
- Produces: migration operation results containing `state`, resolved workspace paths, and diagnostics; `importRepositoryMigrationState()`; conflict error type.

- [ ] Replace repository-state expectations with external-state and zero-target-write tests.
- [ ] Add tests for cross-process reload, safe legacy import, retained legacy source, equal dual state, divergent dual-state refusal, atomic-write rollback, and credential rejection.
- [ ] Run `npx vitest run test/migration.test.ts` and verify failures precede implementation.
- [ ] Implement external atomic state writes and deterministic legacy reconciliation without deleting or overwriting either conflicting file.
- [ ] Run `npx vitest run test/migration.test.ts` and verify all migration tests pass.

### Task 3: CLI workspace and prepare safety contracts

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Consumes: workspace resolver and migration operation results.
- Produces: `workspace resolve TARGET`, `prepare --target TARGET`, `prepare --output DIR --allow-in-repo`, and `migration import TARGET --from-repository`.

- [ ] Add failing JSON-contract tests for workspace resolution, target package output, mutually exclusive options, in-repo refusal before provider calls, no partial output, explicit risk diagnostics, and migration import/conflict.
- [ ] Run `npx vitest run test/cli.test.ts` and verify the new contracts fail.
- [ ] Implement option parsing and envelopes with actual workspace paths and `storageScope` values.
- [ ] Run `npx vitest run test/cli.test.ts` and verify all CLI tests pass.

### Task 4: Skill, documentation, template, and eval contracts

**Files:**
- Modify: `skills/design-replicate/SKILL.md`
- Modify: `skills/design-replicate/references/context-package.md`
- Modify: `skills/design-replicate/references/migration.md`
- Modify: `skills/design-replicate/references/input-contract.md`
- Modify: `skills/design-replicate/references/validation.md`
- Modify: `skills/design-replicate/examples/*.md`
- Modify: `README.md`
- Modify: `templates/design-context.gitignore`
- Modify: `evals/design-replicate/cases.json`
- Modify: `evals/design-replicate/fixtures/*.json`
- Modify: `evals/design-replicate/expected/*.md`
- Modify: `test/skill-contract.test.ts`
- Modify: `test/eval-contract.test.ts`
- Modify: `test/repository-install.test.ts`

**Interfaces:**
- Consumes: the CLI commands from Task 3.
- Produces: an Agent workflow that stores artifacts externally and blocks staged generated files.

- [ ] Update contract tests first to require `workspace resolve`, `prepare --target`, external state/cache, no default `.design-context`, no `.gitignore` mutation, staged-file checks, and no `git add -A`.
- [ ] Run the three contract test files and verify they fail against the old documentation.
- [ ] Rewrite Skill/reference/example/README/template/eval content consistently, including legacy/manual in-repository warnings.
- [ ] Run the three contract test files and verify they pass.

### Task 5: Full regression and zero-pollution acceptance

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release evidence only; no commit or push.

- [ ] Run `npm run check` and fix only regressions caused by this change.
- [ ] Create an isolated Git repository with `mktemp`, run `workspace resolve` and `migration init` with isolated state/cache environment variables, and capture `git status --porcelain`.
- [ ] Verify the status output is empty and all returned paths are outside the temporary Git repository.
- [ ] Run `git diff --check`, secret scanning, and review `git status --short` to enumerate the uncommitted delivery.

### Task 6: Git-local stable identity and readable workspace names

**Files:**
- Modify: `src/core/workspace.ts`
- Modify: `src/index.ts`
- Modify: `test/workspace.test.ts`
- Modify: `test/cli.test.ts`

**Interfaces:**
- Extends: `WorkspacePaths` with `identitySource: 'git-metadata' | 'path-hash'` and `workspaceIdFile: string | null`.
- Produces: atomic `<git-dir>/design-context-bridge/workspace-id`, readable `<workspaceId>--<repository-name>` directories, and external `workspace.json`.

- [ ] Add failing tests that pin the original Git-root hash, survive repository rename, recover after `.git` removal without a rename, reject corrupt metadata, support Git worktree metadata, add readable directory suffixes, and retain empty `git status --porcelain`.
- [ ] Run `npx vitest run test/workspace.test.ts test/cli.test.ts` and verify identity assertions fail against the path-only implementation.
- [ ] Implement Git-directory discovery, atomic ID pinning, path-hash fallback, ID-prefix lookup, plain-directory migration, and external workspace metadata updates.
- [ ] Run `npx vitest run test/workspace.test.ts test/cli.test.ts` and verify all identity and CLI JSON contracts pass.

### Task 7: Identity fallback documentation and final acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `skills/design-replicate/references/migration.md`
- Modify: `test/repository-install.test.ts`
- Modify: `test/skill-contract.test.ts`

**Interfaces:**
- Consumes: identity fields and storage layout from Task 6.
- Produces: documented Git metadata priority, `.git` deletion fallback, and non-Git rename limitation.

- [ ] Update documentation contract tests to require the Git-local ID path, readable directory layout, path-hash fallback, and explicit non-Git rename instructions.
- [ ] Update README, architecture, and Skill migration reference without suggesting a tracked repository identity file.
- [ ] Run `npm run check` and verify secret scan, typecheck, lint, all tests, and build pass.
- [ ] In a `mktemp` Git repository, resolve before and after a directory rename, verify one workspace ID, remove `.git` by moving it aside, resolve again without renaming, and prove `git status --porcelain` was empty while Git existed.
- [ ] Run `git diff --check` and leave every change uncommitted and unpushed.
