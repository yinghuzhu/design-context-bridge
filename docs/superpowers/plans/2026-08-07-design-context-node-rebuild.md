# Design Context Bridge Node.js Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Python 可行性原型归档，并在 `master` 上交付面向前端团队、可通过 npm/npx 使用的通用 Node.js/TypeScript 设计上下文工具和 `design-replicate` Skill。

**Architecture:** 通用 Core 只理解 schema v1、规范化 `design.json` 和 `DesignSourceAdapter`，平台 URL、API、鉴权、原始数据和导出规则封装在 adapter 内。第一版内置 Figma adapter；CLI、context package、迁移状态和 Skill 均使用通用名称，不提供 Python 兼容层。

**Tech Stack:** Node.js 20+、TypeScript、ESM、Vitest、tsup、ESLint、Node 内置 fetch/fs/crypto/Web Streams、npm bin

## Global Constraints

- 项目名与 npm 包名使用 `design-context-bridge`，CLI 使用 `design-context`，Skill 使用 `design-replicate`。
- 新 context package 使用通用 `schemaVersion: 1`；不读取 Python schema v2。
- 新迁移状态只使用 `.design-context/migration.json`；不读取 `.figma-context/`。
- 第一版只实现 Figma adapter，但 Core 和 CLI 不得硬编码 Figma。
- 完整复刻要求多模态 Agent；CLI 不做图片识别、视觉评分或最终视觉结论。
- 不实现自有 MCP、HTTP 服务或动态第三方 adapter 插件加载。
- Figma Token 只从 `FIGMA_TOKEN` 环境变量读取，不进入参数、日志、JSON 或 package。
- 下载使用 sibling staging、结构校验和原子发布；失败保留旧缓存。
- 用户必须指定目标页面、设计 URL、已批准参考和受保护业务；禁止全仓扫描猜测。
- Python 运行实现保留到 Node 功能门禁通过，最后才从 `master` 删除。
- 每个任务先写失败测试，再实现，再运行目标测试和 `npm run check`，最后独立提交。
- 不强推、不重写 `master` 历史；只把归档分支推送到远程，除非用户另行要求推送 `master`。

---

## Planned File Map

| Path | Responsibility |
|---|---|
| `package.json` | npm metadata、bin、build/test/check scripts |
| `src/core/models.ts` | 通用状态、诊断、target、design IR 类型 |
| `src/core/package.ts` | schema v1、fingerprint、校验、原子发布 |
| `src/core/downloader.ts` | adapter 调用、缓存、staging、package 生成 |
| `src/core/context.ts` | AI_CONTEXT/styles/components 确定性生成 |
| `src/core/renderer.ts` | 通用 design IR 辅助 HTML 渲染 |
| `src/core/migration.ts` | `.design-context/migration.json` schema v1 |
| `src/sources/types.ts` | `DesignSourceAdapter` contract |
| `src/sources/registry.ts` | provider 注册与选择 |
| `src/sources/figma/` | Figma URL、REST、normalizer、adapter |
| `src/cli.ts` | `design-context` CLI 与 JSON envelope |
| `skills/design-replicate/` | 通用 Agent 工作流 |
| `scripts/install-skill.ts` | Codex/Claude Code Skill 安装器 |
| `evals/design-replicate/` | 通用跨 Agent 评测包 |
| `test/` | TypeScript tests 与 fixtures |

### Task 0: Archive the Python Prototype

**Files:**
- Verify only; no file changes.

**Interfaces:**
- Consumes: current clean Python prototype commit plus approved Node design and plan.
- Produces: remote branch `origin/archive/python-v0.2` pointing at the complete Python prototype snapshot.

- [ ] **Step 1: Verify the archive point**

Run: `git status --short && git log -1 --oneline && git remote get-url origin`

Expected: clean status, HEAD contains this plan, and origin is the intended `design-context-bridge` repository.

- [ ] **Step 2: Create the archive branch without switching**

Run: `git branch archive/python-v0.2 HEAD && git show-ref --verify refs/heads/archive/python-v0.2`

Expected: archive and `master` resolve to the same commit.

- [ ] **Step 3: Push only the archive branch**

Run: `git push -u origin archive/python-v0.2`

Verify with `git rev-parse archive/python-v0.2` and `git ls-remote --heads origin archive/python-v0.2`. Expected hashes match. Do not push or force-update `master`.

### Task 1: Node Package, Generic Models, and Source Registry

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `tsup.config.ts`, `eslint.config.js`
- Create: `src/index.ts`, `src/core/models.ts`, `src/sources/types.ts`, `src/sources/registry.ts`, `src/sources/figma/url.ts`
- Create: `test/registry.test.ts`

**Interfaces:**
- Produces: `PackageStatus`, `Diagnostic`, `DesignTarget`, `DesignNode`, `DesignDocument`, `PreparedSource`, `DesignSourceAdapter`, `SourceRegistry`, and `parseFigmaUrl()`.
- `SourceRegistry.resolve(url, provider?)` returns `{adapter, target}` and never silently changes an explicit provider.

- [ ] **Step 1: Write failing registry tests**

```ts
import { expect, it } from 'vitest';
import { SourceRegistry } from '../src/sources/registry.js';
import { parseFigmaUrl } from '../src/sources/figma/url.js';

const fakeAdapter = (provider: string, supported: boolean) => ({
  provider,
  supports: () => supported,
  parse: () => { throw new Error('parse must not run for unsupported URL'); },
  prepare: async () => { throw new Error('not used by registry test'); },
  download: async () => { throw new Error('not used by registry test'); }
});

it('parses a Figma URL into a generic target', () => {
  expect(parseFigmaUrl('https://www.figma.com/design/file123/Page?node-id=1-2')).toMatchObject({
    provider: 'figma', documentId: 'file123', nodeId: '1:2', cacheKey: 'figma_file123_1-2'
  });
});

it('rejects an explicit provider mismatch', () => {
  const registry = new SourceRegistry([fakeAdapter('figma', false)]);
  expect(() => registry.resolve('https://example.invalid/design/1', 'figma')).toThrow(/does not support/);
});
```

- [ ] **Step 2: Verify red state**

Run: `npm test -- --run test/registry.test.ts`

Expected: failure because Node configuration and modules are absent.

- [ ] **Step 3: Create Node 20 ESM configuration**

`package.json` must include:

```json
{
  "name": "design-context-bridge",
  "version": "0.1.0",
  "type": "module",
  "engines": {"node": ">=20"},
  "bin": {"design-context": "dist/cli.js"},
  "exports": {".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"}},
  "files": ["dist", "skills/design-replicate", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "check": "npm run typecheck && npm run lint && npm test && npm run build"
  }
}
```

Use TypeScript, tsup, Vitest, ESLint, `@eslint/js`, `typescript-eslint`, and `@types/node` as dev dependencies. Run `npm install` to create the lockfile.

- [ ] **Step 4: Implement focused contracts**

Define these public shapes in `src/core/models.ts` and `src/sources/types.ts`:

```ts
export type PackageStatus = 'complete' | 'partial' | 'invalid';

export interface Diagnostic {
  code: string;
  message: string;
  retryable: boolean;
  nodeId: string | null;
}

export interface DesignTarget {
  provider: string;
  documentId: string;
  nodeId: string;
  sourceUrl: string;
  cacheKey: string;
}

export interface DesignNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  bounds: {x: number; y: number; width: number; height: number} | null;
  children: string[];
  text?: {characters: string; style: Record<string, unknown>};
  style: Record<string, unknown>;
  assetRef?: string;
  componentRef?: string;
  componentProperties?: Record<string, unknown>;
}

export interface DesignDocument {
  provider: string;
  documentId: string;
  rootId: string;
  nodes: Record<string, DesignNode>;
}

export interface SourcePrepareOptions {
  format: 'png' | 'jpg' | 'svg';
  scale: number;
}

export interface RemoteAsset {
  id: string;
  name: string;
  type: string;
  url: string;
  rootScreenshot: boolean;
}

export interface PreparedSource {
  raw: unknown;
  design: DesignDocument;
  screenshot: RemoteAsset;
  assets: RemoteAsset[];
  diagnostics: Diagnostic[];
}
```

```ts
export interface DesignSourceAdapter {
  readonly provider: string;
  supports(url: URL): boolean;
  parse(url: URL): DesignTarget;
  prepare(target: DesignTarget, options: SourcePrepareOptions): Promise<PreparedSource>;
  download(asset: RemoteAsset, destination: string): Promise<void>;
}
```

Only `RemoteAsset` may contain an ephemeral signed URL. `PreparedSource` must separate remote handles from safe JSON metadata so Core cannot serialize download credentials accidentally.

- [ ] **Step 5: Pass foundation checks**

Run: `npm test -- --run test/registry.test.ts && npm run typecheck && npm run lint && npm run build && node dist/cli.js --help`

Expected: tests and checks pass; CLI help exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts eslint.config.js src test/registry.test.ts
git diff --cached --check
git commit -m "refactor: establish generic node design context core"
```

### Task 2: Generic Package Schema and Atomic Publication

**Files:**
- Create: `src/core/package.ts`, `test/package.test.ts`
- Create: `test/fixtures/minimal-package/{manifest.json,design.json,screenshot.png}`
- Create: `test/fixtures/minimal-package/source/raw.json`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 1`, `buildFingerprint()`, `validatePackage()`, and `publishStaging()`.
- Valid packages require safe relative `document`, `rawSource`, `screenshot`, asset paths, and a selected root in `design.json`.

- [ ] **Step 1: Write failing schema tests**

```ts
expect((await validatePackage(fixture)).status).toBe('complete');
expect((await validatePackage(packageWithPath('../escape.png'))).status).toBe('invalid');
expect((await validatePackage(packageWithMissingAsset())).status).toBe('partial');
```

Mock the second rename in `publishStaging` to throw; assert the original destination bytes remain unchanged.

- [ ] **Step 2: Verify red state**

Run: `npm test -- --run test/package.test.ts`

Expected: package functions are missing.

- [ ] **Step 3: Implement schema v1**

```ts
interface PackageManifestV1 {
  schemaVersion: 1;
  source: {provider: string; url: string; documentId: string; nodeId: string};
  document: string;
  rawSource: string;
  screenshot: string;
  export: {format: 'png' | 'jpg' | 'svg'; scale: number};
  fingerprint: string;
  status: PackageStatus;
  files: Record<string, {name: string; type: string; file: string}>;
  diagnostics: Diagnostic[];
}
```

Reject absolute/empty/escaping paths, symlink escape, malformed JSON, invalid source/status/fingerprint, missing core files, or missing selected root. Missing declared non-root assets downgrade to partial with retryable `asset_missing` diagnostics.

- [ ] **Step 4: Implement atomic publication**

Move an existing destination to a UUID sibling backup, rename staging to destination, restore backup on failure, and remove backup only after success. Never recursively delete an unresolved or broad path.

- [ ] **Step 5: Pass and commit**

Run: `npm test -- --run test/package.test.ts && npm run check`

```bash
git add src/core/package.ts test/package.test.ts test/fixtures/minimal-package
git diff --cached --check
git commit -m "feat: add generic design context package schema"
```

### Task 3: Figma Client, Normalizer, and Adapter

**Files:**
- Create: `src/sources/figma/client.ts`, `normalize.ts`, `adapter.ts`
- Create: `test/figma-client.test.ts`, `test/figma-normalize.test.ts`, `test/fixtures/figma-payment-node.json`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `FigmaClient(token, fetchImpl?)`, `normalizeFigmaDocument(raw, target)`, and `FigmaAdapter` implementing `DesignSourceAdapter`.

- [ ] **Step 1: Write failing HTTP tests**

Use injected fake fetch. Assert 41 IDs batch as 40+1, dash IDs normalize to colon IDs, 400/404/422 batch rejection retries individuals, auth/5xx/network propagate correctly, 429 honors bounded Retry-After, download omits the Figma header, and errors expose no Token/signed URL.

- [ ] **Step 2: Write failing normalization tests**

Fixture covers FRAME, TEXT, COMPONENT, INSTANCE, IMAGE fill, SOLID/gradient, stroke, radius, effect, visibility, bounds, auto layout, and variants. Assert stable generic root/nodes/assets/components and deterministic serialization.

- [ ] **Step 3: Verify red state**

Run: `npm test -- --run test/figma-client.test.ts test/figma-normalize.test.ts`

Expected: modules are missing.

- [ ] **Step 4: Implement the platform boundary**

Keep API URL, `X-Figma-Token`, endpoint paths, raw response types, export rules, and node ID normalization under `src/sources/figma/`. Sanitize source URL/raw data. Signed export URLs remain only in ephemeral `RemoteAsset` objects.

- [ ] **Step 5: Pass and commit**

Run: `npm test -- --run test/figma-client.test.ts test/figma-normalize.test.ts && npm run check`

```bash
git add src/sources/figma src/index.ts test/figma-client.test.ts test/figma-normalize.test.ts test/fixtures/figma-payment-node.json
git diff --cached --check
git commit -m "feat: add figma design source adapter"
```

### Task 4: Downloader, Cache, and Context Generation

**Files:**
- Create: `src/core/downloader.ts`, `src/core/context.ts`
- Create: `test/downloader.test.ts`, `test/context.test.ts`

**Interfaces:**
- Produces: `preparePackage(url, registry, options)` and `generateContextFiles(packageDir)`.
- Result exposes package directory, validation, cache hit, and provider; never credentials or remote URLs.

- [ ] **Step 1: Write failing downloader tests**

Using a fake adapter, cover schema v1 publication, screenshot suffix, complete/partial, root failure preserving cache, matching fingerprint avoiding adapter calls, force clearing stale assets, and secret-free manifest/README.

- [ ] **Step 2: Write failing deterministic context tests**

Assert AI_CONTEXT provider/root/regions/text/assets/source priority; deduplicated styles with usage counts; component variants; safe paths; and byte equality across two generations.

- [ ] **Step 3: Verify red state**

Run: `npm test -- --run test/downloader.test.ts test/context.test.ts`

Expected: modules are missing.

- [ ] **Step 4: Implement preparation**

Resolve the adapter, fingerprint target/options, reuse only a validated matching cache, create sibling staging, write raw/design/screenshot/assets/manifest/README, validate, and publish atomically.

- [ ] **Step 5: Implement context generation**

Walk `DesignNode` depth-first. Stable-sort aggregates, preserve top-level order, use manifest screenshot path, and never inline raw source, full design JSON, image bytes, or remote URLs.

- [ ] **Step 6: Pass and commit**

Run: `npm test -- --run test/downloader.test.ts test/context.test.ts && npm run check`

```bash
git add src/core/downloader.ts src/core/context.ts test/downloader.test.ts test/context.test.ts
git diff --cached --check
git commit -m "feat: prepare agent-ready design context packages"
```

### Task 5: Generic Auxiliary Renderer

**Files:**
- Create: `src/core/renderer.ts`
- Create: `test/renderer.test.ts`

**Interfaces:**
- Produces: `renderPackage(packageDir, options?) -> Promise<RenderResult>` using only normalized `design.json` and manifest asset paths.
- Renderer remains auxiliary and cannot emit visual acceptance or similarity scores.

- [ ] **Step 1: Write failing renderer tests**

Cover relative coordinates, escaped title/text/attributes, normalized IMAGE/vector assets, fills/strokes/radius/effects, hidden nodes, missing bounds typed error, and compare HTML reading `.jpg`/`.svg` screenshot paths from manifest.

- [ ] **Step 2: Verify red state**

Run: `npm test -- --run test/renderer.test.ts`

Expected: renderer module is missing.

- [ ] **Step 3: Implement against generic IR**

Validate first, select `DesignDocument.rootId`, render child coordinates relative to the rendered parent, escape all HTML values, and write standalone/optional compare HTML. `src/core/renderer.ts` must not import Figma code.

- [ ] **Step 4: Pass provider-boundary checks**

Add a static test that no file under `src/core/` imports `sources/figma`. Run: `npm test -- --run test/renderer.test.ts && npm run check`.

- [ ] **Step 5: Commit**

```bash
git add src/core/renderer.ts test/renderer.test.ts
git diff --cached --check
git commit -m "feat: render normalized design context packages"
```

### Task 6: Migration State and Agent-Friendly CLI

**Files:**
- Create: `src/core/migration.ts`, `src/cli.ts`
- Create: `test/migration.test.ts`, `test/cli.test.ts`
- Modify: `package.json`, `tsup.config.ts`

**Interfaces:**
- Produces: `.design-context/migration.json` schema v1 and executable `design-context` commands.
- JSON mode emits one `{ok, command, status, data, diagnostics}` object to stdout; human output goes to stderr.

- [ ] **Step 1: Write failing migration tests**

Assert exact schema, approved reference fields, validated target visual/business evidence, recursive credential-key rejection, `.figma-context/` ignored, and failed atomic replace preserving prior bytes.

- [ ] **Step 2: Write failing CLI tests**

Call `main(argv, dependencies)` directly. Cover prepare complete/partial, invalid package exit 20, invalid input 30, missing/auth 40, source API 50, filesystem 60, status without Token, provider mismatch, migration commands, and exactly one secret-free JSON object.

- [ ] **Step 3: Verify red state**

Run: `npm test -- --run test/migration.test.ts test/cli.test.ts`

Expected: migration and CLI modules are missing.

- [ ] **Step 4: Implement only the new contracts**

Write only `.design-context/migration.json`; never detect Python state. Register `FigmaAdapter` in `src/cli.ts`, not Core. Read `FIGMA_TOKEN` only when the selected adapter must contact Figma and no valid cache can satisfy the request.

- [ ] **Step 5: Run offline CLI smoke**

```bash
npm run check
node dist/cli.js --help
node dist/cli.js validate-package test/fixtures/minimal-package --json
node dist/cli.js inspect test/fixtures/minimal-package --json
node dist/cli.js status test/fixtures/minimal-package --json
node dist/cli.js render test/fixtures/minimal-package --output /tmp/design-context-render.html --compare --json
```

Expected: commands exit 0, each JSON output parses, and render output exists.

- [ ] **Step 6: Commit**

```bash
git add src/core/migration.ts src/cli.ts test/migration.test.ts test/cli.test.ts package.json tsup.config.ts
git diff --cached --check
git commit -m "feat: expose generic design context cli"
```

### Task 7: Rename and Generalize the Agent Skill

**Files:**
- Create: `skills/design-replicate/SKILL.md`, `skills/design-replicate/agents/openai.yaml`
- Create: `skills/design-replicate/references/*.md`, `skills/design-replicate/examples/*.md`
- Create: `scripts/install-skill.ts`
- Create: `test/skill-contract.test.ts`, `test/install-skill.test.ts`

**Interfaces:**
- Produces: Skill `design-replicate` for Codex and Claude Code.
- Skill consumes `design-context` and a user-supplied design-platform URL; provider details remain conditional.

- [ ] **Step 1: Write failing Skill tests**

Assert frontmatter, `$design-replicate` metadata, all references, design-platform terminology, multimodal gate, target/source/protected inputs, bounded reads, `.design-context/`, generic CLI commands, browser/auth fallback, visual/business gate, and no active hard-coded `figma-context`, `.figma-context`, or `figma-replicate`.

- [ ] **Step 2: Write failing installer tests**

Assert symlink/copy installs to `.agents/skills/design-replicate` and `.claude/skills/design-replicate`, both-target preflight, broken symlink refusal, and rollback of only current-call paths.

- [ ] **Step 3: Verify red state**

Run: `npm test -- --run test/skill-contract.test.ts test/install-skill.test.ts`

Expected: new Skill and installer are absent.

- [ ] **Step 4: Generate and edit the Skill**

Use the standard Skill initializer, remove placeholders, keep SKILL.md under 500 lines, and route details to one-level input/package/migration/browser/validation references. Provider-specific credentials are selected only after adapter resolution.

- [ ] **Step 5: Implement the Node installer**

Expose `installSkill(source, home, clients, copy)`. Preflight all targets, refuse existing/broken symlink paths, create absolute links or complete copies, and best-effort roll back only newly created destinations.

- [ ] **Step 6: Validate and commit**

Run: `npm test -- --run test/skill-contract.test.ts test/install-skill.test.ts && npm run check`.

If Python and the standard validator are available during development, also run `quick_validate.py skills/design-replicate`; it is not a product runtime dependency.

```bash
git add skills/design-replicate scripts/install-skill.ts test/skill-contract.test.ts test/install-skill.test.ts
git diff --cached --check
git commit -m "feat: add generic design replication skill"
```

### Task 8: Generalize the Cross-Agent Evaluation Pack

**Files:**
- Create: `evals/design-replicate/README.md`, `evals/design-replicate/cases.json`
- Create: `evals/design-replicate/fixtures/*.json`, `evals/design-replicate/expected/*.md`
- Create: `test/eval-contract.test.ts`

**Interfaces:**
- Produces: identical bounded-workflow scenarios for Codex `$design-replicate` and Claude Code `/design-replicate`.

- [ ] **Step 1: Write failing eval tests**

Require the existing eleven safety/migration/browser/business scenarios plus `provider-selection`. Every completion-allowed case must include a real target screenshot action and multimodal source/actual comparison; CLI render/score does not count.

- [ ] **Step 2: Verify red state**

Run: `npm test -- --run test/eval-contract.test.ts`

Expected: generic eval pack is absent.

- [ ] **Step 3: Write provider-neutral cases and runbook**

Use `designUrl` and `provider` fields. First-version fixtures may use Figma, but expected decisions refer to the adapter contract. Isolate workspaces, hide expected reports, capture transcripts/accessed paths, prohibit production credentials, and allow manual identity handoff only for MFA/SSO.

- [ ] **Step 4: Pass and commit**

Run: `npm test -- --run test/eval-contract.test.ts && npm run check`.

```bash
git add evals/design-replicate test/eval-contract.test.ts
git diff --cached --check
git commit -m "test: add generic design replication evaluations"
```

### Task 9: Remove Python Runtime and Finalize npm Distribution

**Files:**
- Delete: `pyproject.toml`, `requirements.txt`, `src/figma_context_bridge/`, `scripts/*.py`
- Delete: `tests/test_*.py`, `tests/fixtures/`, `skills/figma-replicate/`, `evals/figma-replicate/`, `examples/migration.json`
- Modify: `README.md`, `docs/design.md`
- Create or verify: `LICENSE`
- Create: `test/npm-package.test.ts`

**Interfaces:**
- Produces: Node-only repository and npm tarball containing CLI/library types plus `design-replicate` Skill.

- [ ] **Step 1: Write failing npm content test**

Run `npm pack --json --dry-run`, parse its file list, require `dist/cli.js`, `dist/index.js`, declarations, README, LICENSE, and `skills/design-replicate`; reject TypeScript source, tests, fixtures, Python, tokens, downloads, and transcripts.

- [ ] **Step 2: Update documentation**

Document:

```bash
npm install -g design-context-bridge
design-context --help
npx design-context-bridge prepare "$DESIGN_URL" --output .design-context/packages --json
```

Cover Node 20+, Figma adapter `FIGMA_TOKEN`, generic schema v1, Skill install, provider boundary, multimodal requirement, Playwright MCP fallback, and no Python compatibility promise.

- [ ] **Step 3: Remove old runtime only after Node checks pass**

Delete only the explicit paths listed above after `npm run check` is green. Preserve historical plan documents, labelling them archived where current docs link to them.

- [ ] **Step 4: Run the complete release gate**

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --json --dry-run
node dist/cli.js --help
git diff --check
git status --short
```

Install the tarball into a fresh temporary Node project and run help/validate/inspect/status/render. Install the Skill into disposable Codex/Claude homes in link and copy modes.

Expected active-source scan:

```bash
rg -n 'figma_context_bridge|figma-context|\.figma-context|skills/figma-replicate' \
  --glob '!docs/plans/**' --glob '!docs/superpowers/plans/**'
```

Expected: no active product references. Figma names remain only under `src/sources/figma`, provider fixtures, and adapter documentation.

- [ ] **Step 5: Commit the Node-only release candidate**

```bash
git add -A
git diff --cached --check
git commit -m "refactor: complete node design context rebuild"
```

## Final Release Gate

- [ ] `origin/archive/python-v0.2` matches the archived Python snapshot.
- [ ] `master` is clean and no force push occurred.
- [ ] `npm ci && npm run check` passes from a clean install.
- [ ] npm dry-run contains only intended runtime and Skill files.
- [ ] Tarball/npx-style CLI smoke succeeds under Node 20+.
- [ ] Generic validate/inspect/status/render emit one safe JSON envelope.
- [ ] Failed staging preserves previous cache byte-for-byte.
- [ ] Manifests, logs, JSON, state, and eval artifacts contain no secrets.
- [ ] Core imports no Figma implementation; only composition registers it.
- [ ] `design-replicate` passes static and disposable client install tests.
- [ ] Missing input causes no repository scan or modification.
- [ ] Non-multimodal Agent cannot claim visual completion.
- [ ] Visual pass plus business failure blocks acceptance.
- [ ] External Codex/Claude evals are reported honestly as run, skipped, or blocked.
