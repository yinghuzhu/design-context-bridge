#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'Secret scan requires a Git worktree.\n' >&2
  exit 2
}

exec node "$SCRIPT_DIR/check-secrets.mjs" "$REPOSITORY_ROOT"
