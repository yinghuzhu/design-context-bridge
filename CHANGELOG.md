# Changelog

## Unreleased

- Move migration state, design packages, screenshots, assets, and evidence to canonical external workspaces by default.
- Add `workspace resolve`, `prepare --target`, realpath-aware in-repository output refusal, and explicit `--allow-in-repo` risk acceptance.
- Add validated legacy state import, dual-state conflict detection, and staged generated-file gates for Agents.
- Pin the original path hash in Git-local metadata for rename-safe identity, add readable workspace directory names and metadata, and retain path-hash fallback when Git is absent.
- Detect low-information leaf design primitives as non-retryable partial packages, recheck old caches, and block Agent implementation when the source screenshot does not match the user-described target scope.

## 0.2.0 - 2026-08-09

- Distribute from the Git repository through `./scripts/install.sh` instead of an npm registry package.
- Install copied CLI runtime and `design-replicate` Skills for Codex and Claude Code into user-local paths.
- Add safe owned updates, CLI version and refresh behavior, tracked-file credential scanning, persisted-state hardening, and bounded Figma network operations.
- Define `.design-context` migration, package, and evidence policies for team repositories.

## 0.1.0 - 2026-08-08

- Rebuilt the validated proof-of-concept as a provider-neutral Node.js CLI and multimodal Agent Skill.
