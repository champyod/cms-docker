#!/usr/bin/env bash
# tests/test_env_quoting.sh — guard the .env value-quoting contract.
#
# WHY this suite exists: scripts/__config_sync.sh used to write TOML values unquoted,
# so `FUNNEL_REALM = "CMS restricted"` produced the .env line
# `FUNNEL_REALM=CMS restricted`. Sourcing that line makes the shell treat the tail as a
# command (`restricted: command not found`) and leaves FUNNEL_REALM UNSET — the value
# disappears silently, and docker-compose pastes its `${FUNNEL_REALM:-CMS restricted}`
# default over it. A credential with a space, `$`, `#`, a quote or a backslash is lost
# the same way, with no default to hide it.
#
# It runs the REAL generator against a scratch config.toml through CMS_DOCKER_ROOT, so
# the worktree's own .env is never touched, and it needs no docker.
#
# Usage: bash tests/test_env_quoting.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
GENERATOR="${ROOT}/scripts/__config_sync.sh"
BASH_BIN="$(command -v bash)"

# The suite collects failures instead of aborting on the first one, so it must undo the
# strict mode common.sh installs for its consumers. The path is resolved at runtime from
# the repository root, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${ROOT}/scripts/__lib/common.sh"
set +eu +o pipefail
set -u

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

ENV_FILE="${WORK}/.env"
PANEL_ENV_FILE="${WORK}/admin-panel/.env"

PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

check_eq() { # label expected actual
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected [${2}] got [${3}])"; fi
}

# ---------------------------------------------------------------------------
# 1. Scratch config.toml + run the real generator against it
# ---------------------------------------------------------------------------
mkdir -p "${WORK}/admin-panel"
cat > "${WORK}/config.toml" <<'TOML'
[core]
SIMPLE_VALUE = "img"
SPACE_VALUE = "CMS restricted"
DOLLAR_VALUE = "pa$$word$1"
QUOTE_VALUE = "it's \"quoted\""
APOSTROPHE_VALUE = "runner's path"
HASH_VALUE = "pass#word"
COMMENT_VALUE = "value # not a comment"
BACKSLASH_VALUE = "C:\\path\\"
EMPTY_VALUE = ""
BARE_NUM = 8080 # port
POSTGRES_USER = "cmsuser"
POSTGRES_PASSWORD = "p@ss word"
POSTGRES_DB = "cmsdb"
POSTGRES_PORT = 5432

[admin]
DEPLOYMENT_TYPE = "img"
AUTH_SECRET = "plain_hex_alnum"
FUNNEL_REALM = "CMS restricted"

[contest]
CONTEST_ID = 1

[worker]
WORKER_SHARD = 0
TOML

printf '== generating .env from a scratch config.toml ==\n'
if ! CMS_DOCKER_ROOT="$WORK" "$BASH_BIN" "$GENERATOR" --no-secrets >"${WORK}/gen.log" 2>&1; then
  bad "generator exited non-zero"
  sed 's/^/        /' "${WORK}/gen.log"
  printf '\n== summary ==\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  bad "generator did not write ${ENV_FILE}"
  printf '\n== summary ==\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi
ok "generator wrote ${ENV_FILE}"
check_eq "readable section headers survive" "yes" \
  "$(grep -qx '### \[core\] ###' "$ENV_FILE" && echo yes || echo no)"

# ---------------------------------------------------------------------------
# 2. Sourcing the generated file in a clean shell
# ---------------------------------------------------------------------------
# This doubles as the regression for the reported bug: on the old unquoted output the
# stderr below carried "restricted: command not found".
# The snippet is deliberately single-quoted so `$1` expands in the CHILD shell.
# shellcheck disable=SC2016
SOURCE_ERR="$(env -i "$BASH_BIN" -c 'set -a; . "$1"; set +a' _ "$ENV_FILE" 2>&1 >/dev/null)"
check_eq "sourcing .env prints nothing to stderr" "" "$SOURCE_ERR"

# Sourcing happens in a child shell (env -i) so an inherited variable can never mask a
# missing assignment; the snippet is single-quoted so $1/${!2} expand in that child.
# shellcheck disable=SC2016
sourced_value() { # env_file key -> value as a shell that sourced the file sees it
  env -i "$BASH_BIN" -c 'set -a; . "$1"; set +a; if [[ -v $2 ]]; then printf "%s" "${!2}"; else printf "__UNSET__"; fi' \
    _ "$1" "$2" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 3. Every tricky value must round-trip through the shell EXACTLY
# ---------------------------------------------------------------------------
declare -a KEYS=(SIMPLE_VALUE SPACE_VALUE FUNNEL_REALM DOLLAR_VALUE QUOTE_VALUE
                 APOSTROPHE_VALUE HASH_VALUE COMMENT_VALUE BACKSLASH_VALUE
                 EMPTY_VALUE BARE_NUM)
# $'...' for the Windows-style path so the trailing backslash is unambiguous. The
# `$` and quotes inside the entries are LITERAL test data, never meant to expand.
# shellcheck disable=SC2016
declare -a VALUES=(img 'CMS restricted' 'CMS restricted' 'pa$$word$1' 'it'"'"'s "quoted"'
                   "runner's path" 'pass#word' 'value # not a comment' $'C:\\path\\'
                   '' 8080)

printf '\n== source round-trip (shell) ==\n'
for i in "${!KEYS[@]}"; do
  check_eq "${KEYS[$i]} sources to the exact value" "${VALUES[$i]}" "$(sourced_value "$ENV_FILE" "${KEYS[$i]}")"
done

# ---------------------------------------------------------------------------
# 4. Raw parser path: simple values stay bare, quoted values need env_unquote
# ---------------------------------------------------------------------------
# Same shape the consumers use (exact key match, then the shared unquoter).
raw_read() { # file key
  local raw
  raw="$(awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); print v; exit}' "$1" 2>/dev/null | tr -d '\r' || true)"
  env_unquote "$raw"
}

# The Makefile reads DEPLOYMENT_TYPE with grep/cut and does NOT strip quotes.
makefile_raw_read() {
  grep "^DEPLOYMENT_TYPE=" "$1" 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'
}

printf '\n== raw parser path (grep/cut/awk) ==\n'
for i in "${!KEYS[@]}"; do
  check_eq "raw read of ${KEYS[$i]} (env_unquote) yields the exact value" \
    "${VALUES[$i]}" "$(raw_read "$ENV_FILE" "${KEYS[$i]}")"
done

check_eq "strategy (a): a simple value stays BARE" "yes" \
  "$(grep -qx 'SIMPLE_VALUE=img' "$ENV_FILE" && echo yes || echo no)"
check_eq "strategy (a): an empty value stays bare (KEY=)" "yes" \
  "$(grep -qx 'EMPTY_VALUE=' "$ENV_FILE" && echo yes || echo no)"
check_eq "the Makefile DEPLOYMENT_TYPE parse is unaffected" "img" "$(makefile_raw_read "$ENV_FILE")"
check_eq "a value that needs quoting is not left bare" "yes" \
  "$(grep -qE "^SPACE_VALUE='CMS restricted'$" "$ENV_FILE" && echo yes || echo no)"

# Evidence for WHY the shared unquoter had to be added to the consumers: the bare
# grep/cut pipeline the Makefile uses returns the quotes as part of the value.
NAIVE_SPACE="$(grep "^SPACE_VALUE=" "$ENV_FILE" | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r')"
printf '  INFO  unprefixed grep/cut read of SPACE_VALUE: [%s] (quote stripping required)\n' "$NAIVE_SPACE"
if [[ "$NAIVE_SPACE" != 'CMS restricted' ]]; then
  ok "consumer hardening is load-bearing (the unhardened read is lossy)"
else
  bad "consumer hardening is load-bearing (the unhardened read was already exact)"
fi

# ---------------------------------------------------------------------------
# 5. admin-panel/.env is generated from the same values
# ---------------------------------------------------------------------------
printf '\n== admin-panel/.env ==\n'
if [[ -f "$PANEL_ENV_FILE" ]]; then
  check_eq "DATABASE_URL keeps the exact password (space and @ inside)" \
    "postgresql://cmsuser:p@ss word@localhost:5432/cmsdb" "$(sourced_value "$PANEL_ENV_FILE" DATABASE_URL)"
  check_eq "AUTH_SECRET survives" "plain_hex_alnum" "$(sourced_value "$PANEL_ENV_FILE" AUTH_SECRET)"
else
  bad "admin-panel/.env was not generated"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
