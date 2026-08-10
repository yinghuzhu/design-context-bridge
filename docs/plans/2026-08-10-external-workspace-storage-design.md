# External Workspace Storage Design

## Problem

`design-replicate` currently stores migration state, downloaded design packages, and validation evidence under the target repository. Documentation and `.gitignore` templates cannot prevent `git add -A` from staging generated files, so the default storage boundary must move outside the business repository.

## Decision

Use separate state and cache roots. For a valid Git repository, resolve the actual Git directory and read `design-context-bridge/workspace-id`. On first use, pin the SHA-256 of the canonical Git root into that Git-local metadata file. For a non-Git directory or a directory whose `.git` metadata was removed, fall back to the SHA-256 of the target realpath.

State is stored under `DESIGN_CONTEXT_STATE_HOME`, then `XDG_STATE_HOME`, then `~/.local/state`. Packages and evidence are stored under `DESIGN_CONTEXT_CACHE_HOME`, then `XDG_CACHE_HOME`, then `~/.cache`. New roots append `design-context-bridge/workspaces/<workspaceId>--<repository-name>`; the ID prefix is authoritative and the suffix is only a human-readable label.

The pinned value deliberately starts as the original path hash rather than a random UUID. If `.git` is later deleted without moving the directory, path-hash fallback still resolves the same external workspace. A Git-backed directory rename keeps the pinned ID. A non-Git directory rename cannot be recovered automatically and is documented as creating a new workspace.

## Components

- `src/core/workspace.ts` owns canonical path resolution, Git root/Git directory discovery, atomic Git-local identity pinning, readable external directory lookup, workspace metadata, storage-root selection, and safe containment checks.
- `src/core/migration.ts` stores state in the resolved external workspace, validates legacy repository state, imports it without deleting the source, and rejects divergent dual state.
- `src/cli.ts` exposes `workspace resolve`, makes `prepare --target` the default workflow, and rejects manual in-repository output before providers or filesystems are mutated unless `--allow-in-repo` is present.
- The Skill, examples, README, template, and eval fixtures use external workspace paths and require staged-generated-file checks.

## Data flow

1. Resolve the user-supplied target through `realpath`, `git rev-parse --show-toplevel`, and `git rev-parse --absolute-git-dir`.
2. If the Git-local identity file exists, validate and use its 64-character lowercase SHA-256. If it is missing, atomically pin the canonical Git-root path hash. If Git is unavailable, use the target realpath hash without writing target metadata.
3. Resolve state and cache roots, locate an existing directory by authoritative ID prefix, or create `<workspaceId>--<repository-name>`. Migrate the former plain `<workspaceId>` directory name when encountered.
4. Write external `workspace.json` with the display name, current path, previous paths, and current identity source.
5. Return the actual state file, packages directory, evidence directory, workspace ID, `identitySource`, and `storageScope: external`.
6. `prepare --target` writes only below the external packages directory.
7. Migration commands reconcile external and legacy state: validate before copying, report a retained legacy source, and stop on conflict.
8. Manual `--output` is canonicalized through its nearest existing ancestor. If Git reports that it belongs to a worktree, the command refuses before package preparation unless `--allow-in-repo` is also present.

## Error and safety behavior

- `--target` and `--output` are mutually exclusive and one is required.
- `--allow-in-repo` is valid only with `--output`.
- In-repository output returns `storageScope: in-repo` and a risk diagnostic.
- Rejected output creates no directory and performs no provider request.
- Legacy and external migration states that differ are never overwritten or merged.
- No command deletes the repository `.design-context` directory or edits `.gitignore`.
- Existing credential and signed-URL rejection remains mandatory for imported and external state.
- A corrupt Git-local identity file stops resolution and is never silently replaced.
- Git-local identity writes are atomic and do not affect `git status --porcelain`.
- Removing `.git` and renaming the directory at the same time is unrecoverable without user-supplied mapping; the CLI does not guess by directory contents.

## Verification

Unit tests cover canonical workspace identity, first-use metadata pinning, rename stability, `.git` deletion fallback, non-Git rename limitations, worktree Git directories, readable names, separate repositories, path containment, state-root precedence, migration import/conflict, and credential rejection. CLI tests cover JSON contracts, identity source, preflight refusal, explicit risk acceptance, and target-based package output. Skill/eval contract tests forbid default in-repository state and `git add -A`. A final `mktemp` Git repository smoke test must show empty `git status --porcelain` after workspace resolution and migration initialization.
