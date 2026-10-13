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
WRITE=0
WRITE_NAME="rls"
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --write) WRITE=1 ;;
    --write=*) WRITE=1; WRITE_NAME="${arg#--write=}" ;;
    --help|-h) printf 'Usage: %s [--check] [--write[=name]]\n' "$0"; exit 0 ;;
    *) log_die "unknown arg: $arg" 2 ;;
  esac
done

# WHY: the migration directory name is part of the contract with
# prisma migrate deploy (lexical apply order), so the name is
# restricted to the characters Prisma's own directory names use.
if [ "$WRITE" -eq 1 ] && ! printf '%s\n' "$WRITE_NAME" | grep -qE '^[A-Za-z0-9_-]+$'; then
  log_die "migration name must be letters, digits, hyphens or underscores: $WRITE_NAME" 2
fi

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
' "$SCHEMA" | LC_ALL=C sort -u > "$tmp_models"; then
  log_die "failed to parse $SCHEMA" 1
fi

if [ ! -s "$tmp_models" ]; then
  log_die "no models found in $SCHEMA — refusing to emit RLS guards" 1
fi

# WHY LC_ALL=C on every ordering command below: collation is machine-dependent, so an unpinned
# sort/comm emits a different block order and a different coverage verdict per locale — the gate
# then passes locally and fails wherever the locale differs from the author's (a real CI failure).
# WHY sanity: duplicate table names after @@map resolution would emit duplicate guards; fail instead of silently deduping.
if [ "$(LC_ALL=C sort "$tmp_models" | uniq -d | wc -l | tr -d ' ')" -ne 0 ]; then
  dup=$(LC_ALL=C sort "$tmp_models" | uniq -d | tr '\n' ' ')
  log_die "duplicate table names after @@map resolution: $dup" 1
fi

# WHY: collect every table with ENABLE ROW LEVEL SECURITY somewhere in
# migration history. Handles both the to_regclass guard form and the
# direct ALTER TABLE form (including inside EXECUTE). Called again after
# --write so the generator can verify its own output.
# WHY LC_ALL=C on these sorts: the committed migration history is emitted in C order, so anything
# emitted below must use that same order, and comm only agrees with inputs sorted the same way.
collect_covered() {
  local output="$1"
  local tmp_a tmp_b
  tmp_a=$(mktemp)
  tmp_b=$(mktemp)
  grep -h "to_regclass('public\." "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | grep -o "to_regclass('public\.[^']*')" | sed "s/.*public\.//;s/'.*//" | LC_ALL=C sort -u > "$tmp_a" || : > "$tmp_a"
  grep -hE 'ALTER TABLE public\.[A-Za-z_][A-Za-z0-9_]* ENABLE ROW LEVEL SECURITY' "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | sed -n 's/.*ALTER TABLE public\.\([A-Za-z_][A-Za-z0-9_]*\) ENABLE ROW LEVEL SECURITY.*/\1/p' | LC_ALL=C sort -u > "$tmp_b" || : > "$tmp_b"
  cat "$tmp_a" "$tmp_b" | LC_ALL=C sort -u > "$output"
  rm -f "$tmp_a" "$tmp_b"
}

tmp_covered=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_covered"' EXIT
collect_covered "$tmp_covered"

count=$(wc -l < "$tmp_models" | tr -d ' ')

if [ "$CHECK" -eq 1 ]; then
  tmp_uncovered=$(mktemp)
  tmp_extra=$(mktemp)
  trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_uncovered" "$tmp_extra"' EXIT
  LC_ALL=C comm -23 "$tmp_models" "$tmp_covered" > "$tmp_uncovered" || true
  LC_ALL=C comm -13 "$tmp_models" "$tmp_covered" > "$tmp_extra" || true
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

emit_rls_blocks() {
  while IFS= read -r tbl; do
    [ -n "$tbl" ] || continue
    printf 'DO $$ BEGIN\n'
    printf "  IF to_regclass('public.%s') IS NOT NULL THEN\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY';\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s FORCE ROW LEVEL SECURITY';\n" "$tbl"
    # WHY the policy rides along: FORCE makes the table owner subject to
    # RLS too, and every service (CWS, admin panel) connects as cmsuser,
    # the owner — without a permissive policy each access would be denied.
    # The app has no per-user database principal to key a stricter policy
    # on, so cmsuser_all is the only correct policy (same reasoning as the
    # hand-authored 20260912000400_rls_policies for the RBAC tables).
    printf "    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.%s';\n" "$tbl"
    printf "    EXECUTE 'CREATE POLICY cmsuser_all ON public.%s FOR ALL TO cmsuser USING (true) WITH CHECK (true)';\n" "$tbl"
    printf '  END IF;\n'
    printf 'END $$;\n'
  done < "$tmp_uncovered"
}

tmp_uncovered=$(mktemp)
tmp_extra=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_uncovered" "$tmp_extra"' EXIT
LC_ALL=C comm -23 "$tmp_models" "$tmp_covered" > "$tmp_uncovered" || true

if [ ! -s "$tmp_uncovered" ]; then
  if [ "$WRITE" -eq 1 ]; then
    log_info "all $count tables already covered in migration history — nothing to write" >&2
  else
    log_info "all $count tables already covered in migration history — nothing to emit" >&2
  fi
  exit 0
fi

uncovered_count=$(wc -l < "$tmp_uncovered" | tr -d ' ')

# WHY --write: redirecting stdout into a hand-named file with a
# hand-written header let the header drift from the tool that produced
# the body; --write creates the migration directory, stamps the standard
# GENERATED header, and verifies the written file closes every gap.
if [ "$WRITE" -eq 1 ]; then
  # WHY LC_ALL=C: a host whose locale counts years in another
  # era (e.g. th_TH renders 2026 as 2569) would otherwise stamp
  # a migration directory Prisma's lexical apply order never
  # expects, and the timestamp is the only ordering the directory
  # name carries.
  timestamp=$(LC_ALL=C date -u +%Y%m%d%H%M%S)
  migration_dir="${MIGRATIONS_DIR}/${timestamp}_${WRITE_NAME}"
  if [ -e "$migration_dir" ]; then
    log_die "migration directory already exists: $migration_dir" 1
  fi
  mkdir -p "$migration_dir"
  {
    printf '%s\n' \
      "-- ${timestamp}_${WRITE_NAME}/migration.sql — GENERATED — do not hand-edit" \
      "-- Source: admin-panel/prisma/schema.prisma" \
      "-- Generator: scripts/__generate_rls_sql.sh --write=${WRITE_NAME}" \
      "-- WHY GENERATED: ENABLE/FORCE plus the cmsuser_all policy per table, all mechanical from schema.prisma." \
      "-- WHY the policy: FORCE makes the table owner subject to RLS too, and every service connects as cmsuser (the owner), so the permissive policy rides along in the same guarded block." \
      '-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.' \
      "-- To regenerate: bash scripts/__generate_rls_sql.sh --write=${WRITE_NAME}" \
      "-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check" \
      ""
    emit_rls_blocks
  } > "${migration_dir}/migration.sql"

  # WHY the self-check: a written migration that failed to cover the
  # tables it was written for would otherwise only surface as a red CI
  # gate later; re-deriving coverage from the written file makes the
  # generator verify its own output before reporting success.
  tmp_covered_after=$(mktemp)
  tmp_uncovered_after=$(mktemp)
  trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_uncovered" "$tmp_extra" "$tmp_covered_after" "$tmp_uncovered_after"' EXIT
  collect_covered "$tmp_covered_after"
  LC_ALL=C comm -23 "$tmp_models" "$tmp_covered_after" > "$tmp_uncovered_after" || true
  if [ -s "$tmp_uncovered_after" ]; then
    printf '[FAIL] self-check — the written migration does not cover every table:\n' >&2
    while IFS= read -r tbl; do
      [ -n "$tbl" ] && printf '  missing RLS for table: %s\n' "$tbl" >&2
    done < "$tmp_uncovered_after"
    exit 1
  fi
  log_info "wrote ${migration_dir}/migration.sql (${uncovered_count} table(s), self-check OK)"
  exit 0
fi

log_info "emitting RLS guards for $uncovered_count uncovered table(s)" >&2
emit_rls_blocks
