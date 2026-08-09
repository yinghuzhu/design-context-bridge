#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

CLIENT=both
INSTALL_HOME=${HOME:-}
INSTALL_ROOT=
BIN_DIR=
SKIP_CHECK=0
SUCCESS=0
STAGING_DIR=
RUNTIME_BACKUP=
RUNTIME_WAS_PRESENT=0
RUNTIME_SWAPPED=0
WRAPPER_PATHS=()
WRAPPER_BACKUPS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/install.sh [options]

Options:
  --client codex|claude|both  Install Agent Skills (default: both)
  --home DIR                  User home used for Skill destinations
  --install-root DIR          Runtime installation root
  --bin-dir DIR               User-local command directory
  --skip-check                Skip npm ci/check, but still build
  -h, --help                  Show this help
EOF
}

fail() {
  printf 'design-context-bridge install failed: %s\n' "$1" >&2
  exit 1
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

resolve_destination() {
  local value=$1
  local parent
  local name
  parent=$(dirname -- "$value")
  name=$(basename -- "$value")
  mkdir -p -- "$parent"
  parent=$(CDPATH= cd -- "$parent" && pwd -P)
  printf '%s/%s\n' "$parent" "$name"
}

owned_json() {
  local file=$1
  local kind=$2
  [ -f "$file" ] || return 1
  node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = process.argv[2];
    if (value.schemaVersion !== 1 || value.tool !== "design-context-bridge") process.exit(1);
    if (expected === "skill" && value.skill !== "design-replicate") process.exit(1);
  ' "$file" "$kind" >/dev/null 2>&1
}

owned_wrapper() {
  [ -f "$1" ] && head -n 2 "$1" | grep -q '^# design-context-bridge-owned$'
}

random_suffix() {
  node -e 'process.stdout.write(require("node:crypto").randomUUID())'
}

shell_single_quote() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

rollback_and_cleanup() {
  local exit_code=$?
  local index
  trap - EXIT

  if [ "$SUCCESS" -eq 0 ]; then
    for ((index=${#WRAPPER_PATHS[@]} - 1; index >= 0; index -= 1)); do
      if path_exists "${WRAPPER_PATHS[$index]}"; then
        rm -f -- "${WRAPPER_PATHS[$index]}"
      fi
      if [ -n "${WRAPPER_BACKUPS[$index]:-}" ] && path_exists "${WRAPPER_BACKUPS[$index]}"; then
        mv -- "${WRAPPER_BACKUPS[$index]}" "${WRAPPER_PATHS[$index]}"
      fi
    done
    if [ "$RUNTIME_SWAPPED" -eq 1 ]; then
      if path_exists "$INSTALL_ROOT"; then
        rm -rf -- "$INSTALL_ROOT"
      fi
      if [ "$RUNTIME_WAS_PRESENT" -eq 1 ] && [ -n "$RUNTIME_BACKUP" ] && path_exists "$RUNTIME_BACKUP"; then
        mv -- "$RUNTIME_BACKUP" "$INSTALL_ROOT"
      fi
    fi
  fi

  if [ -n "$STAGING_DIR" ] && path_exists "$STAGING_DIR"; then
    rm -rf -- "$STAGING_DIR"
  fi
  if [ "$SUCCESS" -eq 1 ]; then
    if [ -n "$RUNTIME_BACKUP" ] && path_exists "$RUNTIME_BACKUP"; then
      rm -rf -- "$RUNTIME_BACKUP"
    fi
    for index in "${!WRAPPER_BACKUPS[@]}"; do
      if [ -n "${WRAPPER_BACKUPS[$index]}" ] && path_exists "${WRAPPER_BACKUPS[$index]}"; then
        rm -f -- "${WRAPPER_BACKUPS[$index]}"
      fi
    done
  fi
  exit "$exit_code"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --client|--home|--install-root|--bin-dir)
      [ "$#" -ge 2 ] || fail "$1 requires a value"
      case "$1" in
        --client) CLIENT=$2 ;;
        --home) INSTALL_HOME=$2 ;;
        --install-root) INSTALL_ROOT=$2 ;;
        --bin-dir) BIN_DIR=$2 ;;
      esac
      shift 2
      ;;
    --skip-check)
      SKIP_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
done

case "$CLIENT" in
  codex|claude|both) ;;
  *) fail "unsupported client: $CLIENT" ;;
esac

[ -n "$INSTALL_HOME" ] || fail 'a user home is required'
command -v node >/dev/null 2>&1 || fail 'Node.js 20 or later is required'
command -v npm >/dev/null 2>&1 || fail 'npm is required'
command -v git >/dev/null 2>&1 || fail 'git is required'

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or later is required; found $(node --version)"

INSTALL_HOME=$(resolve_destination "$INSTALL_HOME")
mkdir -p -- "$INSTALL_HOME"
INSTALL_ROOT=${INSTALL_ROOT:-"$INSTALL_HOME/.local/share/design-context-bridge"}
BIN_DIR=${BIN_DIR:-"$INSTALL_HOME/.local/bin"}
INSTALL_ROOT=$(resolve_destination "$INSTALL_ROOT")
BIN_DIR=$(resolve_destination "$BIN_DIR")

[ "$INSTALL_ROOT" != / ] || fail 'installation root cannot be /'
[ "$BIN_DIR" != / ] || fail 'binary directory cannot be /'
[ "$INSTALL_ROOT" != "$REPO_DIR" ] || fail 'installation root cannot be the source repository'
[ "$BIN_DIR" != "$REPO_DIR" ] || fail 'binary directory cannot be the source repository'

if path_exists "$INSTALL_ROOT"; then
  owned_json "$INSTALL_ROOT/install-manifest.json" runtime || fail "runtime destination is not owned by design-context-bridge: $INSTALL_ROOT"
  RUNTIME_WAS_PRESENT=1
fi

SKILL_DESTINATIONS=()
if [ "$CLIENT" = codex ] || [ "$CLIENT" = both ]; then
  SKILL_DESTINATIONS+=("$INSTALL_HOME/.agents/skills/design-replicate")
fi
if [ "$CLIENT" = claude ] || [ "$CLIENT" = both ]; then
  SKILL_DESTINATIONS+=("$INSTALL_HOME/.claude/skills/design-replicate")
fi
for destination in "${SKILL_DESTINATIONS[@]}"; do
  if path_exists "$destination"; then
    owned_json "$destination/.design-context-bridge-owned.json" skill || fail "Skill destination is not owned by design-context-bridge: $destination"
  fi
done

mkdir -p -- "$BIN_DIR"
for name in design-context design-context-bridge design-replicate-install; do
  destination="$BIN_DIR/$name"
  if path_exists "$destination" && ! owned_wrapper "$destination"; then
    fail "command destination is not owned by design-context-bridge: $destination"
  fi
done

if [ "$SKIP_CHECK" -eq 0 ]; then
  (cd "$REPO_DIR" && npm ci && npm run check)
else
  (cd "$REPO_DIR" && npm run build)
fi

[ -f "$REPO_DIR/dist/cli.js" ] || fail 'build did not produce dist/cli.js'
[ -f "$REPO_DIR/dist/install-skill.js" ] || fail 'build did not produce dist/install-skill.js'

install_parent=$(dirname -- "$INSTALL_ROOT")
mkdir -p -- "$install_parent"
STAGING_DIR=$(mktemp -d "$install_parent/.design-context-bridge.staging.XXXXXX")
trap rollback_and_cleanup EXIT

cp -R "$REPO_DIR/dist" "$STAGING_DIR/dist"
mkdir -p "$STAGING_DIR/skills"
cp -R "$REPO_DIR/skills/design-replicate" "$STAGING_DIR/skills/design-replicate"
if [ -d "$REPO_DIR/templates" ]; then
  cp -R "$REPO_DIR/templates" "$STAGING_DIR/templates"
fi
cp "$REPO_DIR/package.json" "$REPO_DIR/LICENSE" "$STAGING_DIR/"

project_version=$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$REPO_DIR/package.json")
source_commit=$(git -C "$REPO_DIR" rev-parse HEAD)
node -e '
  const fs = require("node:fs");
  const value = { schemaVersion: 1, tool: "design-context-bridge", version: process.argv[2], sourceCommit: process.argv[3] };
  fs.writeFileSync(process.argv[1], `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
' "$STAGING_DIR/install-manifest.json" "$project_version" "$source_commit"

if [ "$RUNTIME_WAS_PRESENT" -eq 1 ]; then
  RUNTIME_BACKUP="$install_parent/.design-context-bridge.backup-$(random_suffix)"
  mv -- "$INSTALL_ROOT" "$RUNTIME_BACKUP"
fi
mv -- "$STAGING_DIR" "$INSTALL_ROOT"
STAGING_DIR=
RUNTIME_SWAPPED=1

for name in design-context design-context-bridge design-replicate-install; do
  destination="$BIN_DIR/$name"
  backup=
  if path_exists "$destination"; then
    backup="$BIN_DIR/.$name.backup-$(random_suffix)"
    mv -- "$destination" "$backup"
  fi
  WRAPPER_PATHS+=("$destination")
  WRAPPER_BACKUPS+=("$backup")
  case "$name" in
    design-replicate-install) target="$INSTALL_ROOT/dist/install-skill.js" ;;
    *) target="$INSTALL_ROOT/dist/cli.js" ;;
  esac
  quoted_target=$(shell_single_quote "$target")
  temporary="$BIN_DIR/.$name.staging-$(random_suffix)"
  printf '%s\n' '#!/usr/bin/env bash' '# design-context-bridge-owned' "exec node '$quoted_target' \"\$@\"" > "$temporary"
  chmod 755 "$temporary"
  mv -- "$temporary" "$destination"
done

node "$INSTALL_ROOT/dist/install-skill.js" --client "$CLIENT" --copy --update-owned --home "$INSTALL_HOME" --source "$INSTALL_ROOT/skills/design-replicate"

"$BIN_DIR/design-context" --version >/dev/null
for destination in "${SKILL_DESTINATIONS[@]}"; do
  [ -f "$destination/SKILL.md" ] || fail "Skill verification failed: $destination"
done

SUCCESS=1
printf 'Installed design-context-bridge %s\n' "$project_version"
printf 'CLI: %s/design-context\n' "$BIN_DIR"
printf 'Agent Skill: %s\n' "$CLIENT"
case ":${PATH:-}:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add the CLI to PATH: export PATH="%s:$PATH"\n' "$BIN_DIR" ;;
esac
