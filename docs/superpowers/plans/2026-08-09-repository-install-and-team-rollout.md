# Repository Installation and Team Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Design Context Bridge directly from its Git repository through one safe user-local shell installer, with no npm publication path and with production-grade security, cache-refresh, network, CI, and team-onboarding gates.

**Architecture:** `scripts/install.sh` is the only team installation entrypoint. It builds and verifies the private Node workspace, atomically publishes a copied runtime under the user's local data directory, creates user-local command wrappers, and delegates owned Skill replacement to the existing TypeScript installer. Core and provider code keep their current boundaries; focused changes add version/refresh behavior, URL and migration hardening, bounded Figma requests, and tracked-file secret scanning.

**Tech Stack:** Bash 3.2+, Node.js 20+, TypeScript ESM, tsup, Vitest, ESLint, GitHub Actions.

## Global Constraints

- Do not publish an npm package and do not document `npm install -g`, `npx`, or `npm publish` as a supported path.
- `package.json` must set `private: true`; npm remains dependency/build tooling only.
- Default installation is user-local, requires no `sudo`, and must not edit shell startup files.
- Default Skill target is both Codex and Claude Code; `--client codex|claude|both` remains available.
- The installed runtime and Skill are copies, not links to the checkout.
- Node.js 20 is the minimum supported runtime.
- `FIGMA_TOKEN` remains environment-only and must never be accepted by the installer or persisted.
- Existing unrelated worktree changes must be preserved.
- Each task ends with a focused English Git commit.

---

## File Map

- `scripts/install.sh`: repository-first build, verification, atomic user-local runtime/wrapper installation, and Skill installation orchestration.
- `scripts/check-secrets.sh`: tracked-file credential pattern gate that reports paths without printing matched values.
- `scripts/install-skill.ts`: safe owned Skill updates and ownership marker validation.
- `src/version.ts`: single CLI version constant, checked against `package.json`.
- `src/cli.ts`: `--version` and `--refresh` alias.
- `src/sources/figma/url.ts`: persisted Figma URL canonicalization.
- `src/sources/figma/client.ts`: timeouts, response size limits, and HTTP-date retry handling.
- `src/core/migration.ts`: credential-shaped value and evidence-path validation.
- `templates/design-context.gitignore`: target-project state policy.
- `.github/workflows/ci.yml`: Node 20/22 checks and disposable installer smoke test.
- `test/repository-install.test.ts`: private distribution and shell installer contract.
- `test/secret-scan.test.ts`: scanner pass/fail behavior without secret disclosure.
- Existing focused tests: CLI, registry, Figma client, migration, and Skill installer.
- `README.md`, `docs/design.md`, `CHANGELOG.md`: supported team workflow and release boundary.

---

### Task 1: Disable npm publication and expose version/refresh behavior

**Files:**
- Create: `src/version.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `test/cli.test.ts`
- Replace: `test/npm-package.test.ts` with `test/repository-install.test.ts`

**Interfaces:**
- Produces: `VERSION: string` and CLI flags `--version`, `--refresh`.
- Consumes: existing `preparePackage(..., { force })` option.

- [ ] **Step 1: Write failing private-distribution and CLI tests**

Add assertions equivalent to:

```ts
it('is private and has no npm publication lifecycle', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as Record<string, unknown>;
  expect(pkg.private).toBe(true);
  expect((pkg.scripts as Record<string, string>).prepack).toBeUndefined();
});

it('prints the project version', async () => {
  const h = harness();
  expect(await main(['--version'], h.dependencies)).toBe(EXIT_OK);
  expect(h.stdout()).toBe(`${VERSION}\n`);
});

it('maps --refresh to force preparation', async () => {
  let force = false;
  const h = harness({
    preparePackage: async (_url, _registry, options) => {
      force = options.force === true;
      return completePrepareResult();
    },
  });
  await main(['prepare', FIGMA_URL, '--output', '/tmp/output', '--refresh', '--json'], h.dependencies);
  expect(force).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npm test -- --run test/cli.test.ts test/repository-install.test.ts`

Expected: FAIL because `private`, `VERSION`, and `--refresh` do not exist and the npm distribution test still describes tarballs.

- [ ] **Step 3: Implement the minimal version and refresh contract**

Create:

```ts
export const VERSION = '0.2.0';
```

Set `private: true`, set package version to `0.2.0`, remove `files` and `prepack`, retain local `bin` metadata, update the lockfile root metadata, export `VERSION`, and treat `--refresh` as the same boolean as `--force`. `--version` writes only `${VERSION}\n` to stdout and performs no filesystem or provider work.

- [ ] **Step 4: Run focused and full checks**

Run: `npm test -- --run test/cli.test.ts test/repository-install.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/version.ts src/cli.ts src/index.ts test/cli.test.ts test/repository-install.test.ts test/npm-package.test.ts
git commit -m "feat: make repository installation the release boundary"
```

---

### Task 2: Make Skill installation safely update owned copies

**Files:**
- Modify: `scripts/install-skill.ts`
- Modify: `test/install-skill.test.ts`

**Interfaces:**
- Produces: ownership marker `.design-context-bridge-owned.json` and `--update-owned`.
- Consumes: source Skill directory, target home, selected clients, and copy mode.

- [ ] **Step 1: Add failing ownership/update tests**

Add these exact cases using `mkdtemp`, `writeFile`, and the existing installer entrypoint:

```ts
it('writes an ownership marker for copied installs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-owned-'));
  const source = await makeSkill(root, 'current');
  await installSkill(source, join(root, 'home'), ['codex'], true);
  const marker = JSON.parse(await readFile(join(root, 'home', '.agents', 'skills', 'design-replicate', '.design-context-bridge-owned.json'), 'utf8'));
  expect(marker).toEqual({ schemaVersion: 1, tool: 'design-context-bridge', skill: 'design-replicate' });
});

it('atomically replaces an owned copied Skill with updateOwned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-update-'));
  const home = join(root, 'home');
  await installSkill(await makeSkill(root, 'old'), home, ['codex'], true);
  await installSkill(await makeSkill(root, 'new'), home, ['codex'], true, {}, true);
  await expect(readFile(join(home, '.agents', 'skills', 'design-replicate', 'VERSION'), 'utf8')).resolves.toBe('new');
});

it('refuses to overwrite an unowned directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-unknown-'));
  const destination = join(root, 'home', '.agents', 'skills', 'design-replicate');
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'user-file'), 'keep');
  await expect(installSkill(await makeSkill(root, 'new'), join(root, 'home'), ['codex'], true, {}, true)).rejects.toThrow(/owned/i);
  await expect(readFile(join(destination, 'user-file'), 'utf8')).resolves.toBe('keep');
});
```

- [ ] **Step 2: Run the tests and verify red**

Run: `npm test -- --run test/install-skill.test.ts`

Expected: FAIL because ownership markers and update semantics are absent.

- [ ] **Step 3: Implement owned atomic replacement**

Use sibling staging and backup directories with UUID suffixes. A valid marker is:

```json
{
  "schemaVersion": 1,
  "tool": "design-context-bridge",
  "skill": "design-replicate"
}
```

Only copied installs receive markers. `--update-owned` may replace a destination only after validating this exact marker. Unknown directories and broken symlinks remain hard failures. On failure, restore the backup and remove only staging paths created by the current invocation.

- [ ] **Step 4: Run tests and static checks**

Run: `npm test -- --run test/install-skill.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-skill.ts test/install-skill.test.ts
git commit -m "feat: safely update owned agent skills"
```

---

### Task 3: Add the one-command repository installer

**Files:**
- Create: `scripts/install.sh`
- Modify: `test/repository-install.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: repository `package.json`, `package-lock.json`, `dist/`, Skill source, `git`, `node`, and `npm`.
- Produces: user-local runtime, wrappers, install manifest, and selected Skill copies.

- [ ] **Step 1: Add failing installer contract and smoke tests**

The tests run the installer with disposable `--home`, `--install-root`, and `--bin-dir` paths plus `--skip-check` after building once. Assert:

```ts
expect(await readlinkOrReadWrapper(binDir, 'design-context')).toContain('dist/cli.js');
expect(await exists(join(home, '.agents/skills/design-replicate/SKILL.md'))).toBe(true);
expect(await exists(join(home, '.claude/skills/design-replicate/SKILL.md'))).toBe(true);
expect(JSON.parse(await readFile(join(installRoot, 'install-manifest.json'), 'utf8'))).toMatchObject({
  schemaVersion: 1,
  tool: 'design-context-bridge',
});
```

Also cover `--client codex`, `--client claude`, update of an owned install, refusal to overwrite an unknown Skill, missing Node, and Node below 20 through injectable command paths/environment.

- [ ] **Step 2: Run the installer test and verify red**

Run: `npm run build && npm test -- --run test/repository-install.test.ts`

Expected: FAIL because `scripts/install.sh` is missing.

- [ ] **Step 3: Implement `scripts/install.sh`**

Use Bash strict mode and self-location:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
```

Supported options are exactly:

```text
--client codex|claude|both
--home DIR
--install-root DIR
--bin-dir DIR
--skip-check
--help
```

Defaults are `both`, the current user's home, `$HOME/.local/share/design-context-bridge`, and `$HOME/.local/bin`. Reject empty, root, repository-root, and unresolved destinations. Default execution runs `npm ci`, `npm run check`, and `npm run build` in `REPO_DIR`.

Copy `dist`, `skills/design-replicate`, `templates`, `package.json`, and `LICENSE` into a sibling staging directory. Write `install-manifest.json` with schema version, tool, project version, and `git rev-parse HEAD`; never serialize environment values. Atomically replace an owned runtime after validating its manifest. Create wrapper files through temporary siblings and `mv`:

```bash
#!/usr/bin/env bash
exec node "INSTALL_ROOT/dist/cli.js" "$@"
```

Invoke the staged/copied installer with `--copy --update-owned --source INSTALL_ROOT/skills/design-replicate`. Verify CLI help/version and selected Skill files. Print an exact PATH instruction only when `BIN_DIR` is absent from `PATH`.

- [ ] **Step 4: Run shell syntax, focused tests, and manual disposable smoke**

Run:

```bash
bash -n scripts/install.sh
npm test -- --run test/repository-install.test.ts test/install-skill.test.ts
tmp_home=$(mktemp -d)
./scripts/install.sh --home "$tmp_home" --install-root "$tmp_home/share/design-context-bridge" --bin-dir "$tmp_home/bin" --skip-check
"$tmp_home/bin/design-context" --version
```

Expected: syntax succeeds; tests pass; installed CLI prints `0.2.0`; both Skill files exist.

- [ ] **Step 5: Commit**

```bash
git add scripts/install.sh test/repository-install.test.ts .gitignore
git commit -m "feat: add repository-first team installer"
```

---

### Task 4: Add automated tracked-file secret scanning

**Files:**
- Create: `scripts/check-secrets.sh`
- Create: `test/secret-scan.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run check:secrets`, exit `0` when clean and nonzero with file paths only when suspicious values exist.

- [ ] **Step 1: Write failing scanner tests**

Create disposable Git repositories and execute `bash scripts/check-secrets.sh` with the disposable repository as its working directory:

```ts
it('accepts explicit placeholders and invalid test domains', async () => {
  const repo = await makeGitFixture({ 'safe.txt': 'figd_xxxxxxxxxxxxxxxxxxxxx https://signed.invalid/?token=secret' });
  await expect(runScanner(repo)).resolves.toMatchObject({ exitCode: 0 });
});

it('rejects a credential-shaped tracked value without printing it', async () => {
  const credential = `figd_${'A'.repeat(32)}`;
  const repo = await makeGitFixture({ 'unsafe.txt': credential });
  const result = await runScanner(repo);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('unsafe.txt');
  expect(result.stderr).not.toContain(credential);
});

it('ignores untracked local files', async () => {
  const repo = await makeGitFixture({ 'safe.txt': 'tracked' });
  await writeFile(join(repo, '.env'), `FIGMA_TOKEN=figd_${'B'.repeat(32)}\n`);
  await expect(runScanner(repo)).resolves.toMatchObject({ exitCode: 0 });
});
```

- [ ] **Step 2: Run the tests and verify red**

Run: `npm test -- --run test/secret-scan.test.ts`

Expected: FAIL because the scanner does not exist.

- [ ] **Step 3: Implement the scanner and quality-gate integration**

The Bash script uses `git ls-files -z` and a Node inline scanner or portable text loop. It detects common live formats (`figd_`, GitHub tokens, AWS access IDs, OpenAI-style keys, bearer credentials, PEM private keys, and secret-like assignments), permits only explicit placeholder values and `.invalid` fixtures, and reports only paths. It never reads ignored files or prints matched content.

Add:

```json
"check:secrets": "bash scripts/check-secrets.sh",
"check": "npm run check:secrets && npm run typecheck && npm run lint && npm test && npm run build"
```

- [ ] **Step 4: Run focused and repository scans**

Run: `npm test -- --run test/secret-scan.test.ts && npm run check:secrets`

Expected: PASS; no credential values are printed.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-secrets.sh test/secret-scan.test.ts package.json package-lock.json
git commit -m "security: add tracked credential gate"
```

---

### Task 5: Harden persisted URLs and migration evidence

**Files:**
- Modify: `src/sources/figma/url.ts`
- Modify: `src/core/migration.ts`
- Modify: `test/registry.test.ts`
- Modify: `test/migration.test.ts`

**Interfaces:**
- Produces: canonical persisted Figma URL and recursive sensitive-value rejection.

- [ ] **Step 1: Add failing URL and migration tests**

Cover:

```ts
expect(parseFigmaUrl('https://www.figma.com/design/file/Page?node-id=1-2&t=session&utm_source=x').sourceUrl)
  .toBe('https://www.figma.com/design/file/Page?node-id=1-2');

expect(() => validateMigrationState(stateWithValue('https://x.invalid/a?token=live-value')))
  .toThrow(/sensitive/i);
expect(() => validateMigrationState(validatedTargetWithVisualEvidence('../outside.png')))
  .toThrow(/relative/i);
expect(() => validateMigrationState(validatedTargetWithVisualEvidence('/tmp/out.png')))
  .toThrow(/relative/i);
```

Retain `version-id` only when present and non-empty; remove all other query parameters.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- --run test/registry.test.ts test/migration.test.ts`

Expected: FAIL because unknown query parameters and credential-shaped values are currently accepted.

- [ ] **Step 3: Implement canonicalization and value validation**

Rebuild `sourceUrl.search` from an allowlist of `node-id` and optional `version-id`. Recursively reject strings containing credential schemes or URLs with sensitive query keys (`token`, `authorization`, `secret`, `signature`, `expires`, `x-amz-credential`, `x-amz-signature`). For `visualEvidence`, require non-empty relative paths that contain no `..` segment and are not absolute on POSIX or Windows.

- [ ] **Step 4: Run focused and static checks**

Run: `npm test -- --run test/registry.test.ts test/migration.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/figma/url.ts src/core/migration.ts test/registry.test.ts test/migration.test.ts
git commit -m "security: harden persisted design context state"
```

---

### Task 6: Bound Figma network operations

**Files:**
- Modify: `src/sources/figma/client.ts`
- Modify: `test/figma-client.test.ts`

**Interfaces:**
- Extends: `FigmaClientOptions` with `requestTimeoutMs?: number`, `maximumDownloadBytes?: number`, and injectable clock/timer hooks only if required for deterministic tests.

- [ ] **Step 1: Add failing timeout, size, and Retry-After tests**

Add deterministic tests with injected fetch and sleep functions:

```ts
it('passes an abort signal to every request', async () => {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return response({ nodes: {} });
  });
  await new FigmaClient('test-token', fetchImpl, { requestTimeoutMs: 25 }).fetchNode(target);
});

it('rejects a declared oversized download before reading the body', async () => {
  const body = vi.fn(async () => new ArrayBuffer(1));
  const fetchImpl = vi.fn(async () => new Response(null, { status: 200, headers: { 'content-length': '11' } }));
  const client = new FigmaClient('test-token', fetchImpl, { maximumDownloadBytes: 10 });
  await expect(client.download('https://assets.invalid/a', destination)).rejects.toThrow(/size/i);
  expect(body).not.toHaveBeenCalled();
});

it('rejects oversized actual bytes without writing the destination', async () => {
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array(11), { status: 200 }));
  const client = new FigmaClient('test-token', fetchImpl, { maximumDownloadBytes: 10 });
  await expect(client.download('https://assets.invalid/a', destination)).rejects.toThrow(/size/i);
  await expect(readFile(destination)).rejects.toThrow();
});

it('honors an HTTP-date Retry-After within the configured cap', async () => {
  const sleep = vi.fn(async () => undefined);
  const retryAt = new Date(Date.now() + 60_000).toUTCString();
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(response({}, 429, { 'Retry-After': retryAt }))
    .mockResolvedValueOnce(response({ nodes: {} }));
  await new FigmaClient('test-token', fetchImpl, { sleep, maximumRetryDelayMs: 1_000 }).fetchNode(target);
  expect(sleep).toHaveBeenCalledWith(1_000);
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npm test -- --run test/figma-client.test.ts`

Expected: FAIL because requests have no timeout/size limit and HTTP-date is ignored.

- [ ] **Step 3: Implement bounded fetch and download**

Default request timeout is 30 seconds and default single download limit is 50 MiB. Use an `AbortController`, clear its timer in `finally`, and preserve typed auth/source/network errors without embedding URLs or response bodies. Reject an oversized declared length before `arrayBuffer()`, verify the actual byte length before `writeFile`, and never leave a partial destination. Parse numeric Retry-After as seconds and valid dates as `max(0, date-now)` before applying `maximumRetryDelayMs`.

- [ ] **Step 4: Run focused and static checks**

Run: `npm test -- --run test/figma-client.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/figma/client.ts test/figma-client.test.ts
git commit -m "security: bound figma network operations"
```

---

### Task 7: Document team state policy and supported installation

**Files:**
- Create: `templates/design-context.gitignore`
- Create: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/design.md`
- Modify: `skills/design-replicate/references/context-package.md`
- Modify: `skills/design-replicate/references/migration.md`
- Modify: historical plan headers under `docs/plans/` and `docs/superpowers/plans/`
- Modify: `test/skill-contract.test.ts`
- Modify: `test/repository-install.test.ts`

**Interfaces:**
- Produces: one supported installation command and explicit cache/state rules.

- [ ] **Step 1: Add failing documentation contract tests**

Assert README and active design docs contain `./scripts/install.sh`, `--refresh`, `~/.local/bin`, package/evidence ignore policy, environment-only `FIGMA_TOKEN`, and no supported `npm install -g`, `npx design-context-bridge`, or `npm publish` commands. Assert historical plans begin with a non-normative notice.

- [ ] **Step 2: Run documentation tests and verify red**

Run: `npm test -- --run test/repository-install.test.ts test/skill-contract.test.ts`

Expected: FAIL on the old npm instructions and missing state template.

- [ ] **Step 3: Update supported documentation and Skill policy**

Provide the exact onboarding flow:

```bash
git clone git@github.com:yinghuzhu/design-context-bridge.git
cd design-context-bridge
./scripts/install.sh
export PATH="$HOME/.local/bin:$PATH"
design-context --version
```

Use a placeholder-only Figma credential example and state that the user configures it outside the repository. Document update by `git pull --ff-only && ./scripts/install.sh`, `--client`, cache reuse versus `--refresh`, and the target `.gitignore` template:

```gitignore
.design-context/packages/
.design-context/evidence/
```

Do not ignore `.design-context/migration.json` by default. Add changelog entry `0.2.0` for repository-first installation. Add an explicit historical notice to obsolete Python/schema-v2 plans without rewriting their archaeological content.

- [ ] **Step 4: Run documentation and full Skill contract tests**

Run: `npm test -- --run test/repository-install.test.ts test/skill-contract.test.ts test/eval-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/design.md CHANGELOG.md templates/design-context.gitignore skills/design-replicate/references/context-package.md skills/design-replicate/references/migration.md docs/plans docs/superpowers/plans test/skill-contract.test.ts test/repository-install.test.ts
git commit -m "docs: publish repository-first team onboarding"
```

---

### Task 8: Add CI and final release-readiness verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `test/repository-install.test.ts`

**Interfaces:**
- Produces: Node 20/22 CI with no publish job.

- [ ] **Step 1: Add a failing CI contract test**

Assert the workflow contains Node versions `20` and `22`, `npm ci`, `npm run check`, a disposable `scripts/install.sh --skip-check` smoke, installed `design-context --version`, and no `npm publish`/registry token configuration.

- [ ] **Step 2: Run the contract test and verify red**

Run: `npm test -- --run test/repository-install.test.ts`

Expected: FAIL because `.github/workflows/ci.yml` is missing.

- [ ] **Step 3: Add the CI workflow**

Use `actions/checkout@v4` and `actions/setup-node@v4` with npm cache. Run the full check on both Node versions. Run the disposable installer smoke on Node 20 with explicit temporary home/install/bin paths and verify Codex/Claude Skill entrypoints. Do not create a release or publish job.

- [ ] **Step 4: Run final local verification and audit**

Run:

```bash
npm ci
npm run check
bash -n scripts/install.sh scripts/check-secrets.sh
tmp_home=$(mktemp -d)
./scripts/install.sh --home "$tmp_home" --install-root "$tmp_home/share/design-context-bridge" --bin-dir "$tmp_home/bin" --skip-check
"$tmp_home/bin/design-context" --version
git grep -n -I -E 'figd_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}' -- .
git log --all -G 'figd_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}' --oneline -- .
git diff --check
git status --short
```

Expected: all automated checks and installer smoke pass; grep/log hits contain only documented placeholders or invalid test fixtures after manual review; no unintended tracked files exist.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml test/repository-install.test.ts
git commit -m "ci: verify repository installer on supported node versions"
```

---

## Self-Review

- Spec coverage: repository-only distribution, user-local installer, both Agent clients, updates, no npm publishing, refresh semantics, network bounds, state/privacy policy, CI, documentation, and secret audit each have an owning task.
- Placeholder scan: every task names its exact files, commands, expected failures, implementation contract, and expected passing result; fake credential strings are explicitly placeholders or invalid-domain fixtures.
- Type consistency: `VERSION`, `--refresh`, ownership marker schema v1, install manifest schema v1, `requestTimeoutMs`, and `maximumDownloadBytes` are named consistently across producers and consumers.
