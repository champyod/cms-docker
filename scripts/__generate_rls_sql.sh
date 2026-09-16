#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

SCHEMA="${REPO_ROOT}/admin-panel/prisma/schema.prisma"
SQL_DIR="${REPO_ROOT}/admin-panel/prisma/sql"
OUT_FILE="${SQL_DIR}/20260820125500_rls_enable.sql"

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --help|-h) printf 'Usage: %s [--check]\n' "$0"; exit 0 ;;
    *) log_die "unknown arg: $arg" 2 ;;
  esac
done

[ -f "$SCHEMA" ] || log_die "missing $SCHEMA" 1
[ -d "$SQL_DIR" ] || log_die "missing $SQL_DIR" 1

# WHY: extraction must honour @@map("...") if present — anchored on @@map( never bare map: to avoid matching @@index(map: ...)
tmp_models=$(mktemp)
trap 'rm -f "$tmp_models"' EXIT

# WHY blunt grep -E '^model ' is sufficient and is the house style; awk honours @@map for identity or renamed tables.
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
' "$SCHEMA" | LC_ALL=C sort -u > "$tmp_models"; then
  log_die "failed to parse $SCHEMA" 1
fi

# WHY fail closed: empty model list would emit a header with no guards — a silent fail-open. Abort instead and write no file.
if [ ! -s "$tmp_models" ]; then
  log_die "no models found in $SCHEMA — refusing to emit empty RLS enable file" 1
fi

count=$(wc -l < "$tmp_models" | tr -d ' ')
# WHY LC_ALL=C throughout: collation is machine-dependent, so an unpinned sort emits a different
# block order per locale and the freshness check fails wherever the locale differs from the author's.
# WHY sanity: duplicate table names after @@map resolution would emit duplicate guards; fail instead of silently deduping.
if [ "$(LC_ALL=C sort "$tmp_models" | uniq -d | wc -l | tr -d ' ')" -ne 0 ]; then
  dup=$(LC_ALL=C sort "$tmp_models" | uniq -d | tr '\n' ' ')
  log_die "duplicate table names after @@map resolution: $dup" 1
fi

# WHY write to temp then atomically mv: a parse error or crash mid-write must never hand psql a half-written slab.
tmp_out=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_out"' EXIT

{
  printf -- '-- 20260820125500_rls_enable.sql — GENERATED — do not hand-edit\n'
  printf -- '-- Source: admin-panel/prisma/schema.prisma\n'
  printf -- '-- Generator: scripts/__generate_rls_sql.sh\n'
  printf -- '-- WHY GENERATED: this block is mechanical ENABLE/FORCE per table from schema.prisma. Hand-authored policies live in 20260820130000_rls.sql.\n'
  printf -- '-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.\n'
  printf -- '-- To regenerate: bash scripts/__generate_rls_sql.sh\n'
  printf -- '-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check\n'
  printf '\n'
  while IFS= read -r tbl; do
    [ -n "$tbl" ] || continue
    # WHY existence-guarded and idempotent: ENABLE/FORCE are re-runnable; to_regclass IS NOT NULL skips missing tables so a renamed/dropped table does not abort the apply.
    printf 'DO $$ BEGIN\n'
    printf "  IF to_regclass('public.%s') IS NOT NULL THEN\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY';\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s FORCE ROW LEVEL SECURITY';\n" "$tbl"
    printf '  END IF;\n'
    printf 'END $$;\n'
  done < "$tmp_models"
} > "$tmp_out"

if [ "$CHECK" -eq 1 ]; then
  if [ ! -f "$OUT_FILE" ]; then
    log_die "generated file missing at $OUT_FILE — run bash scripts/__generate_rls_sql.sh to create it" 1
  fi
  if ! diff -u "$OUT_FILE" "$tmp_out" >/dev/null 2>&1; then
    printf '[FAIL] RLS enable SQL is stale — run bash scripts/__generate_rls_sql.sh to regenerate\n' >&2
    diff -u "$OUT_FILE" "$tmp_out" >&2 || true
    exit 1
  fi
  log_info "RLS enable SQL is fresh ($count tables)"
  exit 0
fi

# WHY atomic mv only on success: ensures a broken generator never leaves a half-written file for psql to apply.
mv "$tmp_out" "$OUT_FILE"
trap 'rm -f "$tmp_models"' EXIT
log_info "generated $OUT_FILE ($count tables)"
