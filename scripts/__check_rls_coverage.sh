#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${SCRIPT_DIR}/__lib/common.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/__lib/common.sh"
fi
declare -F log_info >/dev/null 2>&1 || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null 2>&1 || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die  >/dev/null 2>&1 || log_die()  { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }

SCHEMA="${REPO_ROOT}/admin-panel/prisma/schema.prisma"
MIGRATIONS_DIR="${REPO_ROOT}/admin-panel/prisma/migrations"
GENERATOR="${REPO_ROOT}/scripts/__generate_rls_sql.sh"

[ -f "$SCHEMA" ] || log_die "missing $SCHEMA" 1
[ -d "$MIGRATIONS_DIR" ] || log_die "missing $MIGRATIONS_DIR" 1
[ -f "$GENERATOR" ] || log_die "missing $GENERATOR" 1

tmp_schema=$(mktemp)
tmp_mig=$(mktemp)
tmp_chk=$(mktemp)
trap 'rm -f "$tmp_schema" "$tmp_mig" "$tmp_chk"' EXIT

# WHY: extract model→table set from schema.prisma, honouring @@map("...") — anchored on @@map( never bare map: to avoid @@index(map: ...)
if ! awk '
  /^model [A-Za-z_][A-Za-z0-9_]* \{/ {
    model=$2
    table=model
    in_block=1
    next
  }
  in_block && /@@map\(/ {
    line=$0
    q1=index(line, "\"")
    if (q1 > 0) {
      rest=substr(line, q1+1)
      q2=index(rest, "\"")
      if (q2 > 0) table=substr(rest, 1, q2-1)
    }
    next
  }
  in_block && /^\}/ {
    print table
    in_block=0
    table=""
    model=""
    next
  }
' "$SCHEMA" | sort -u > "$tmp_schema"; then
  log_die "failed to parse $SCHEMA" 1
fi

if [ ! -s "$tmp_schema" ]; then
  log_die "no models found in $SCHEMA" 1
fi

# WHY: extract table set from ENABLE ROW LEVEL SECURITY across migration history.
tmp_a=$(mktemp)
tmp_b=$(mktemp)
trap 'rm -f "$tmp_schema" "$tmp_mig" "$tmp_chk" "$tmp_a" "$tmp_b"' EXIT
grep -h "to_regclass('public\." "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | grep -o "to_regclass('public\.[^']*')" | sed "s/.*public\.//;s/'.*//" | sort -u > "$tmp_a" || : > "$tmp_a"
grep -hE 'ALTER TABLE public\.[A-Za-z_][A-Za-z0-9_]* ENABLE ROW LEVEL SECURITY' "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | sed -n 's/.*ALTER TABLE public\.\([A-Za-z_][A-Za-z0-9_]*\) ENABLE ROW LEVEL SECURITY.*/\1/p' | sort -u > "$tmp_b" || : > "$tmp_b"
cat "$tmp_a" "$tmp_b" | sort -u > "$tmp_mig"

# WHY two-direction comm: missing = fail-open security hole (model has no RLS), extra = drift (RLS for a dropped table).
missing=$(comm -23 "$tmp_schema" "$tmp_mig" || true)
extra=$(comm -13 "$tmp_schema" "$tmp_mig" || true)

rc=0
# WHY also verify generator coverage: every model must be covered somewhere in migration history.
stale=0
if ! bash "$GENERATOR" --check >"$tmp_chk" 2>&1; then
  stale=1
  rc=1
  printf 'RLS coverage FAILED:\n' >&2
  cat "$tmp_chk" >&2
fi

if [ -n "$missing" ]; then
  if [ "$stale" -eq 0 ]; then
    printf 'RLS coverage FAILED:\n' >&2
  fi
  printf '%s\n' "$missing" | while IFS= read -r m; do
    [ -n "$m" ] && printf '  missing RLS for table: %s\n' "$m" >&2
  done
  rc=1
fi
if [ -n "$extra" ]; then
  if [ "$stale" -eq 0 ] && [ -z "$missing" ]; then
    printf 'RLS coverage FAILED:\n' >&2
  fi
  printf '%s\n' "$extra" | while IFS= read -r e; do
    [ -n "$e" ] && printf '  extra RLS for unknown table: %s\n' "$e" >&2
  done
  rc=1
fi

if [ "$rc" -ne 0 ]; then
  exit 1
fi

count=$(wc -l < "$tmp_schema" | tr -d ' ')
log_info "RLS coverage OK ($count tables matched)"
