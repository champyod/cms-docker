#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# WHY: both sets below are compared with comm, so both sorts run under LC_ALL=C —
# collation is machine-dependent, and a locale-ordered sort would mismatch them.
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
' "$SCHEMA" | LC_ALL=C sort -u > "$tmp_schema"; then
  log_die "failed to parse $SCHEMA" 1
fi

if [ ! -s "$tmp_schema" ]; then
  log_die "no models found in $SCHEMA" 1
fi

# WHY: extract table set from ENABLE ROW LEVEL SECURITY across migration history.
# WHY LC_ALL=C on these sorts and on the comms below: collation is machine-dependent, so unpinned
# sort/comm disagree about ordering — comm only agrees with inputs sorted its own way — and the
# check then passes locally and fails wherever the locale differs from the author's (a real CI failure).
tmp_a=$(mktemp)
tmp_b=$(mktemp)
tmp_pol=$(mktemp)
trap 'rm -f "$tmp_schema" "$tmp_mig" "$tmp_chk" "$tmp_a" "$tmp_b" "$tmp_pol"' EXIT
grep -h "to_regclass('public\." "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | grep -o "to_regclass('public\.[^']*')" | sed "s/.*public\.//;s/'.*//" | LC_ALL=C sort -u > "$tmp_a" || : > "$tmp_a"
grep -hE 'ALTER TABLE public\.[A-Za-z_][A-Za-z0-9_]* ENABLE ROW LEVEL SECURITY' "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | sed -n 's/.*ALTER TABLE public\.\([A-Za-z_][A-Za-z0-9_]*\) ENABLE ROW LEVEL SECURITY.*/\1/p' | LC_ALL=C sort -u > "$tmp_b" || : > "$tmp_b"
cat "$tmp_a" "$tmp_b" | LC_ALL=C sort -u > "$tmp_mig"

# WHY two-direction comm: missing = fail-open security hole (model has no RLS), extra = drift (RLS for a dropped table).
missing=$(LC_ALL=C comm -23 "$tmp_schema" "$tmp_mig" || true)
extra=$(LC_ALL=C comm -13 "$tmp_schema" "$tmp_mig" || true)

# WHY a policy check on top of the enable check: ENABLE+FORCE without any policy makes the
# table return zero rows to the owner and reject its inserts — a silent failure the
# enable-only check cannot see.
grep -hE 'CREATE POLICY [A-Za-z_][A-Za-z0-9_]* ON public\.' "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null \
  | sed -n 's/.*CREATE POLICY [A-Za-z_][A-Za-z0-9_]* ON public\.\([A-Za-z_][A-Za-z0-9_]*\).*/\1/p' \
  | LC_ALL=C sort -u > "$tmp_pol" || : > "$tmp_pol"
no_policy=$(LC_ALL=C comm -23 "$tmp_b" "$tmp_pol" || true)

# WHY a permissive-surface check: coverage and "has a policy" are both satisfied by
# `FOR ALL ... USING (true) WITH CHECK (true)` — the exact body that made RLS decorative. So the
# committed policy set is checked for two things it must NOT contain, and one symmetric set it must:
#   1. no whole-table tautology anywhere,
#   2. a SELECT-only tautology on a table the generator did not declare as public-board-readable,
#   3. and the declared public-board set exactly equal to the tables that carry one.
# The allowlist is read from the generator, not restated here, so there is one list.
tmp_region=$(mktemp)
tmp_perm=$(mktemp)
tmp_allow=$(mktemp)
trap 'rm -f "$tmp_schema" "$tmp_mig" "$tmp_chk" "$tmp_a" "$tmp_b" "$tmp_pol" "$tmp_region" "$tmp_perm" "$tmp_allow"' EXIT
cat "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | sed -n '/^-- BEGIN GENERATED POLICY SET/,/^-- END GENERATED POLICY SET/p' > "$tmp_region" || : > "$tmp_region"
# Tables carrying a bare `FOR SELECT ... USING (true)`.
sed -n 's/^CREATE POLICY [A-Za-z_][A-Za-z0-9_]* ON public\.\([A-Za-z_][A-Za-z0-9_]*\) FOR SELECT TO cmsuser USING (true);$/\1/p' "$tmp_region" | LC_ALL=C sort -u > "$tmp_perm" || : > "$tmp_perm"
permissive=$(printf '%s\n' "$(sed -n 's/^PUBLIC_BOARD_READ="\(.*\)"$/\1/p' "$GENERATOR" | tr ' ' '\n' | sed '/^$/d' | LC_ALL=C sort -u)")
printf '%s\n' "$permissive" > "$tmp_allow"
undeclared=$(LC_ALL=C comm -23 "$tmp_perm" "$tmp_allow" || true)
tautology=$(grep -cE 'FOR ALL TO cmsuser USING \(true\) WITH CHECK \(true\)' "$tmp_region" || true)

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
if [ -n "$no_policy" ]; then
  if [ "$stale" -eq 0 ] && [ -z "$missing" ] && [ -z "$extra" ]; then
    printf 'RLS coverage FAILED:\n' >&2
  fi
  printf '%s\n' "$no_policy" | while IFS= read -r t; do
    [ -n "$t" ] && printf '  FORCE RLS without a policy: %s\n' "$t" >&2
  done
  rc=1
fi

if [ "$tautology" -ne 0 ]; then
  if [ "$stale" -eq 0 ] && [ -z "$missing" ] && [ -z "$extra" ] && [ -z "$no_policy" ]; then
    printf 'RLS coverage FAILED:\n' >&2
  fi
  printf '  whole-table tautology (USING (true) WITH CHECK (true)) on %s table(s) — RLS is decorative there\n' "$tautology" >&2
  rc=1
fi

if [ -n "$undeclared" ]; then
  if [ "$stale" -eq 0 ] && [ -z "$missing" ] && [ -z "$extra" ] && [ -z "$no_policy" ] && [ "$tautology" -eq 0 ]; then
    printf 'RLS coverage FAILED:\n' >&2
  fi
  printf '%s\n' "$undeclared" | while IFS= read -r t; do
    [ -n "$t" ] && printf '  permissive SELECT on a table the generator does not declare public-board-readable: %s\n' "$t" >&2
  done
  rc=1
fi

if [ "$rc" -ne 0 ]; then
  exit 1
fi

count=$(wc -l < "$tmp_schema" | tr -d ' ')
log_info "RLS coverage OK ($count tables matched)"
