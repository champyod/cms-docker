#!/usr/bin/env bash
# Resolve a tool the migration path needs — the Prisma CLI or the TypeScript
# runner — by searching every location it can plausibly live in, on both sides
# of the container boundary.
#
# WHY this exists as a script rather than inline in the Makefile: the search is
# long enough to get wrong, and Make escaping makes it near-impossible to read
# or test. The Makefile calls this once per tool.
#
# Output on success: one line, "<dir>\t<command>", where <dir> is the working
# directory the command must run from. On failure: the ordered list of what was
# tried, on stderr, and exit 1.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

CONTAINER="${CMS_ADMIN_CONTAINER:-cms-admin-panel-next}"

# WHY two budgets: a probe against something already on disk answers in well
# under a second, but `npx`/`pnpm dlx`/`bun x` fetch the package first, so they
# need room. Probing those without a bound made this script hang for minutes on
# a host with no network.
LOCAL_PROBE_TIMEOUT="${CMS_PROBE_TIMEOUT:-15}"
FETCH_PROBE_TIMEOUT="${CMS_FETCH_PROBE_TIMEOUT:-180}"

tool="${1:-}"
case "$tool" in
  prisma)
    BIN="prisma"; PKG="prisma@6"; PRESENT="prisma/schema.prisma"
    ;;
  tsx)
    BIN="tsx"; PKG="tsx@4"; PRESENT="prisma/seed-permissions.ts"
    ;;
  *)
    echo "usage: $(basename "$0") <prisma|tsx>" >&2
    exit 2
    ;;
esac

TRIED=()
CONTAINER_UP=0
if command -v docker >/dev/null 2>&1 \
   && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  CONTAINER_UP=1
fi

# --- probes ---------------------------------------------------------------
# A candidate is accepted only if it runs AND the file it is meant to operate on
# is reachable from the directory we would run it in. Existence alone is not
# enough: a stale bind-mount can hold a binary but not the schema.
probe_container() {
  local dir="$1" cmd="$2" budget="$3"
  # shellcheck disable=SC2016 # $PRESENT/$cmd must expand inside the container
  timeout "$budget" docker exec "$CONTAINER" sh -lc \
    "cd '$dir' 2>/dev/null && [ -f '$PRESENT' ] && $cmd --version" >/dev/null 2>&1
}

probe_host() {
  local dir="$1" cmd="$2" budget="$3"
  ( cd "$dir" 2>/dev/null && [ -f "$PRESENT" ] && timeout "$budget" $cmd --version ) >/dev/null 2>&1
}

try_container() {
  local dir="$1" cmd="$2" budget="${3:-$LOCAL_PROBE_TIMEOUT}"
  TRIED+=("container:$dir: $cmd")
  if probe_container "$dir" "$cmd" "$budget"; then
    printf '%s\t%s\n' "$dir" "$cmd"
    exit 0
  fi
}

try_host() {
  local dir="$1" cmd="$2" budget="${3:-$LOCAL_PROBE_TIMEOUT}"
  TRIED+=("host:$dir: $cmd")
  if probe_host "$dir" "$cmd" "$budget"; then
    printf '%s\t%s\n' "$dir" "$cmd"
    exit 0
  fi
}

# --- in-container candidates ---------------------------------------------
# Ordered so the self-sufficient, offline options come first and anything that
# needs registry access comes last.
if [ "$CONTAINER_UP" -eq 1 ]; then
  C_DIR="/app"
  docker exec "$CONTAINER" test -f "/app/$PRESENT" 2>/dev/null || C_DIR="/repo-root/admin-panel"

  # 1. the binary the image ships, 2. the binary on the host bind-mount
  try_container "$C_DIR" "$C_DIR/node_modules/.bin/$BIN"
  try_container "$C_DIR" "/repo-root/admin-panel/node_modules/.bin/$BIN"

  # 3. a global install on the container PATH
  if docker exec "$CONTAINER" sh -lc "command -v $BIN" >/dev/null 2>&1; then
    try_container "$C_DIR" "$BIN"
  else
    TRIED+=("container:$C_DIR: $BIN (not on PATH)")
  fi

  # 4-5. the container ships pnpm, so its runner and dlx are real options
  if docker exec "$CONTAINER" sh -lc 'command -v pnpm' >/dev/null 2>&1; then
    try_container "$C_DIR" "pnpm exec $BIN"
    try_container "$C_DIR" "pnpm dlx $PKG" "$FETCH_PROBE_TIMEOUT"
  else
    TRIED+=("container:$C_DIR: pnpm (not installed)")
  fi

  # 6. bun, if this image ever gains it
  if docker exec "$CONTAINER" sh -lc 'command -v bun' >/dev/null 2>&1; then
    try_container "$C_DIR" "bun x $PKG" "$FETCH_PROBE_TIMEOUT"
  else
    TRIED+=("container:$C_DIR: bun (not installed)")
  fi

  # 7. last resort inside the container: fetch it
  if docker exec "$CONTAINER" sh -lc 'command -v npx' >/dev/null 2>&1; then
    try_container "$C_DIR" "npx --yes $PKG" "$FETCH_PROBE_TIMEOUT"
  else
    TRIED+=("container:$C_DIR: npx (not installed)")
  fi
fi

# --- host candidates ------------------------------------------------------
# Reached when the container cannot provide the tool, so the update can still
# finish from the host rather than stopping at the first miss.
try_host "admin-panel" "admin-panel/node_modules/.bin/$BIN"
if command -v "$BIN" >/dev/null 2>&1; then
  try_host "admin-panel" "$BIN"
else
  TRIED+=("host:admin-panel: $BIN (not on PATH)")
fi
if [ -x "${HOME}/.bun/bin/$BIN" ]; then
  try_host "admin-panel" "${HOME}/.bun/bin/$BIN"
fi
if command -v pnpm >/dev/null 2>&1; then
  try_host "admin-panel" "pnpm exec $BIN"
  try_host "admin-panel" "pnpm dlx $PKG" "$FETCH_PROBE_TIMEOUT"
fi
if command -v bun >/dev/null 2>&1; then
  try_host "admin-panel" "bun x $PKG" "$FETCH_PROBE_TIMEOUT"
fi
if command -v npx >/dev/null 2>&1; then
  try_host "admin-panel" "npx --yes $PKG" "$FETCH_PROBE_TIMEOUT"
fi

# --- nothing worked -------------------------------------------------------
{
  echo "ERROR: no usable '$BIN' found for the migration path."
  echo "  Tried, in order:"
  printf '    - %s\n' "${TRIED[@]}"
  if [ "$CONTAINER_UP" -eq 1 ]; then
    echo "  Most likely fix: rebuild the admin image so it ships the tool"
    echo "    (docker compose --profile core --profile admin up -d --build $CONTAINER),"
    echo "    or pull a newer admin image tag."
  else
    echo "  The admin container is not running. Start the stack, or install the"
    echo "    panel dependencies on this host (cd admin-panel && bun install)."
  fi
} >&2
exit 1
