#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

SCHEMA="${REPO_ROOT}/admin-panel/prisma/schema.prisma"
MIGRATIONS_DIR="${REPO_ROOT}/admin-panel/prisma/migrations"

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --help|-h) printf 'Usage: %s [--check]\n' "$0"; exit 0 ;;
    *) log_die "unknown arg: $arg" 2 ;;
  esac
done

[ -f "$SCHEMA" ] || log_die "missing $SCHEMA" 1
[ -d "$MIGRATIONS_DIR" ] || log_die "missing $MIGRATIONS_DIR" 1

tmp_models=$(mktemp)
trap 'rm -f "$tmp_models"' EXIT

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
' "$SCHEMA" | sort -u > "$tmp_models"; then
  log_die "failed to parse $SCHEMA" 1
fi

if [ ! -s "$tmp_models" ]; then
  log_die "no models found in $SCHEMA — refusing to emit RLS guards" 1
fi

if [ "$(sort "$tmp_models" | uniq -d | wc -l | tr -d ' ')" -ne 0 ]; then
  dup=$(sort "$tmp_models" | uniq -d | tr '\n' ' ')
  log_die "duplicate table names after @@map resolution: $dup" 1
fi

tmp_covered=$(mktemp)
tmp_a=$(mktemp)
tmp_b=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_a" "$tmp_b"' EXIT

# WHY: collect every table with ENABLE ROW LEVEL SECURITY somewhere in migration history.
# Handles both the to_regclass guard form and the direct ALTER TABLE form (including inside EXECUTE).
grep -h "to_regclass('public\." "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | grep -o "to_regclass('public\.[^']*')" | sed "s/.*public\.//;s/'.*//" | sort -u > "$tmp_a" || : > "$tmp_a"
grep -hE 'ALTER TABLE public\.[A-Za-z_][A-Za-z0-9_]* ENABLE ROW LEVEL SECURITY' "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | sed -n 's/.*ALTER TABLE public\.\([A-Za-z_][A-Za-z0-9_]*\) ENABLE ROW LEVEL SECURITY.*/\1/p' | sort -u > "$tmp_b" || : > "$tmp_b"
cat "$tmp_a" "$tmp_b" | sort -u > "$tmp_covered"

count=$(wc -l < "$tmp_models" | tr -d ' ')

if [ "$CHECK" -eq 1 ]; then
  tmp_uncovered=$(mktemp)
  tmp_extra=$(mktemp)
  trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_a" "$tmp_b" "$tmp_uncovered" "$tmp_extra"' EXIT
  comm -23 "$tmp_models" "$tmp_covered" > "$tmp_uncovered" || true
  comm -13 "$tmp_models" "$tmp_covered" > "$tmp_extra" || true
  rc=0
  if [ -s "$tmp_uncovered" ]; then
    printf '[FAIL] RLS coverage gap — tables without ENABLE ROW LEVEL SECURITY in migration history:\n' >&2
    while IFS= read -r tbl; do
      [ -n "$tbl" ] && printf '  missing RLS for table: %s\n' "$tbl" >&2
    done < "$tmp_uncovered"
    rc=1
  fi
  if [ -s "$tmp_extra" ]; then
    printf '[FAIL] RLS coverage extra — tables with RLS in migration history but not in schema:\n' >&2
    while IFS= read -r tbl; do
      [ -n "$tbl" ] && printf '  extra RLS for unknown table: %s\n' "$tbl" >&2
    done < "$tmp_extra"
    rc=1
  fi
  if [ "$rc" -ne 0 ]; then
    exit 1
  fi
  log_info "RLS enable coverage OK ($count tables)"
  exit 0
fi

tmp_uncovered=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_a" "$tmp_b" "$tmp_uncovered"' EXIT
comm -23 "$tmp_models" "$tmp_covered" > "$tmp_uncovered" || true

if [ ! -s "$tmp_uncovered" ]; then
  log_info "all $count tables already covered in migration history — nothing to emit" >&2
  exit 0
fi

uncovered_count=$(wc -l < "$tmp_uncovered" | tr -d ' ')
log_info "emitting RLS guards for $uncovered_count uncovered table(s)" >&2
while IFS= read -r tbl; do
  [ -n "$tbl" ] || continue
  printf 'DO $$ BEGIN\n'
  printf "  IF to_regclass('public.%s') IS NOT NULL THEN\n" "$tbl"
  printf "    EXECUTE 'ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY';\n" "$tbl"
  printf "    EXECUTE 'ALTER TABLE public.%s FORCE ROW LEVEL SECURITY';\n" "$tbl"
  printf '  END IF;\n'
  printf 'END $$;\n'
done < "$tmp_uncovered"
