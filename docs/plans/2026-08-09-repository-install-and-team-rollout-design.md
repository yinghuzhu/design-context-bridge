# Repository Installation and Team Rollout Design

## Goal

Distribute Design Context Bridge directly from its Git repository to frontend team members without publishing an npm package. A single shell entrypoint must build and verify the Node.js project, install user-local CLI commands, install the `design-replicate` Skill for Codex and Claude Code, and avoid requiring `sudo` or a system-wide Node.js change.

The rollout also closes the release-readiness gaps identified after the first real T-Plus acceptance: deterministic updates, explicit cache refresh, safer persisted URLs and migration state, bounded network operations, automated CI, repository secret scanning, and clear handling of `.design-context` artifacts.

## Distribution Model

Team members clone or update this repository and run:

```bash
./scripts/install.sh
```

The repository remains a private Node.js workspace used by npm only for dependency management and builds. `package.json` sets `private: true`; documentation does not instruct users to run `npm install -g`, `npx`, or `npm publish`.

The installer:

1. resolves the repository from its own location instead of the caller's working directory;
2. requires Node.js 20 or later plus npm;
3. runs `npm ci`, the repository quality/security gate, and `npm run build`;
4. copies the built runtime and Skill into a user-local installation root;
5. installs `design-context`, `design-context-bridge`, and `design-replicate-install` wrappers under `~/.local/bin`;
6. installs copies of the Skill for both Codex and Claude Code by default;
7. refuses to overwrite an unowned Skill installation;
8. verifies the installed CLI and both Skill entrypoints before reporting success.

User-local paths are configurable without requiring root access. The default layout is:

```text
~/.local/share/design-context-bridge/
├── dist/
├── skills/design-replicate/
└── install-manifest.json

~/.local/bin/
├── design-context
├── design-context-bridge
└── design-replicate-install

~/.agents/skills/design-replicate/
~/.claude/skills/design-replicate/
```

The runtime and Skill are copied rather than linked to the checkout, so moving or deleting the repository does not break an installed tool. Updates rerun the same installer. Owned destinations are replaced through sibling staging and backup paths; failure restores the previous installation. Unknown existing destinations cause a safe stop.

The installer does not edit `.zshrc`, `.bashrc`, or other shell startup files. If `~/.local/bin` is not on `PATH`, it prints the exact export line and the absolute installed command path.

## CLI and Cache Behavior

The existing `--force` behavior remains compatible. A clearer `--refresh` alias is added and documented for cases where a design node may have changed without changing its URL. The Skill uses refresh for a newly requested or explicitly updated design and reuses a validated cache only for a confirmed continuation where the source is unchanged.

The CLI exposes `--version` so support requests can identify the installed build. The installed manifest records the source Git commit and project version without storing credentials.

## Security and Privacy

No installer argument accepts a Figma token. `FIGMA_TOKEN` remains an environment-only runtime credential and is never copied into the installation root, wrappers, manifests, logs, migration state, or target repositories.

Figma source URLs are canonicalized before persistence. Only query parameters required to identify an immutable source selection are retained; unknown tracking or sharing parameters are removed. Migration validation rejects credential-shaped keys and values, sensitive URL query parameters, and unsafe evidence paths.

A repository-owned secret scan checks tracked source, tests, documentation, examples, and generated distribution files for common live credential formats. Known fake domains and explicit placeholders remain permitted. The security gate runs in local checks, the installer, and CI.

The current Git history is audited separately before rollout. If a real credential is ever found, it must be revoked first; deleting it from the latest tree is not sufficient.

## Network Safety

Figma API and asset requests receive bounded timeouts. Asset responses are rejected when their declared or actual size exceeds configured limits. Retries remain limited to transient network errors, HTTP 429, and 5xx responses, and support both numeric and HTTP-date `Retry-After` values. Diagnostics stay typed and redacted.

## Target Repository State

Team guidance distinguishes durable migration facts from private/generated design data:

- `.design-context/migration.json` may be committed after project review because it contains only confirmed, non-sensitive facts and relative evidence references.
- `.design-context/packages/` is local/generated and should be ignored.
- `.design-context/evidence/` is local or a CI artifact unless a project explicitly approves committing screenshots.

A reusable gitignore template is shipped with the repository. The Skill must not silently commit generated packages or evidence.

## CI and Documentation

GitHub Actions runs on Node.js 20 and 22 and executes dependency installation, type checking, linting, tests, secret scanning, build, and an installer smoke test in a disposable home directory. There is no npm publish job.

README becomes the supported team onboarding path. Historical Python and schema-v2 implementation plans remain for archaeology but are explicitly marked historical and non-normative. A changelog records repository-distributed releases and the source Git tag or commit is the version boundary.

## Validation

Completion requires:

- clean install and update tests in disposable user homes;
- Codex-only, Claude-only, and default-both Skill installation coverage;
- refusal to overwrite an unknown existing Skill;
- CLI help, version, package validation, and refresh behavior tests;
- secret scan over current tracked files and Git history audit evidence;
- Node 20/22 CI configuration;
- `npm run check` and an end-to-end repository installer smoke test;
- a clean Git worktree apart from the intended implementation commits.

