#!/usr/bin/env bash
# scripts/__generate_role_sql.sh — render the WS-75 role catalog into one idempotent SQL file.
#
# WHY a generator: the role list, the column grants and the RLS policies must agree with each
# other, and the deployed file must be reproducible from the repository so a gate can prove the
# commit is current. Three hand-maintained copies would drift, and the failure mode of that drift is
# silent — a role with a grant but no policy reads zero rows and reports a missing record instead of
# a permission error.
#
# INPUT  admin-panel/prisma/roles/catalog.tsv   role, login, bypassrls, comment
#        admin-panel/prisma/roles/grants.tsv    role, table, privilege, columns, sequence
# OUTPUT admin-panel/prisma/sql/20260820110000_generated_roles.sql
#
# USAGE
#   bash scripts/__generate_role_sql.sh            print the SQL to stdout, write nothing
#   bash scripts/__generate_role_sql.sh --write    write (or rewrite) the committed file
#   bash scripts/__generate_role_sql.sh --check    render to a temp file and diff the committed one;
#                                                  exit 1 on drift, naming the regenerate command
#
# WHAT THE OUTPUT MAY NOT CONTAIN, and why (enforced by the validation below and pinned by
# tests/test_role_catalog.sh): no ownership change, no subtraction of an existing privilege, no
# literal password, no table drop, and no redefinition of the roles that already serve the running
# app. This file is applied by `make prisma-sync` to a LIVE database whose application is up, so its
# only safe shape is additive. Ownership transfer and the privilege subtraction are a separate,
# rehearsed step; the panel's per-role connections are another.
#
# ROLE-NAME CONTRACT (a name outside it is fatal, not a warning): the catalog is the only place a
# role name is written, and an unchecked typo there becomes a role that nothing grants to — which
# reads exactly like a broken application.
#   cms_platform_<capability>
#   cms_admin_login                 the one admin role without a domain: it runs before a session
#   cms_admin_<capability>_<domain> capability is read | write | operate | account
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

ROLES_DIR="${REPO_ROOT}/admin-panel/prisma/roles"
CATALOG="${ROLES_DIR}/catalog.tsv"
GRANTS="${ROLES_DIR}/grants.tsv"
OUT="${REPO_ROOT}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"

REGEN_CMD="bash scripts/__generate_role_sql.sh --write"
CHECK_CMD="bash scripts/__generate_role_sql.sh --check"

usage() {
  cat <<'EOF'
Usage: bash scripts/__generate_role_sql.sh [--check | --write]

  (no flag)   print the generated SQL to stdout; the file is not touched
  --write     write admin-panel/prisma/sql/20260820110000_generated_roles.sql
  --check     render to a temporary file and diff the committed SQL; exit 1 on drift
  --help      this text

Inputs:  admin-panel/prisma/roles/catalog.tsv, admin-panel/prisma/roles/grants.tsv
EOF
}

MODE=print
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --write) MODE="write" ;;
    --help|-h) usage; exit 0 ;;
    *) printf '[FAIL] unknown arg: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

for f in "$CATALOG" "$GRANTS"; do
  [ -f "$f" ] || log_die "missing input ${f#"${REPO_ROOT}/"} — the generator has nothing to render" 1
done

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
trap 'rm -rf "$tmpdir"' HUP INT TERM

# ── Validation ───────────────────────────────────────────────────────────────────────────────
# WHY the contract lives in awk and not in a grep per call site: one definition, one exit path, and
# the offending file:line reaches the operator instead of a bare "invalid input".
validate_catalog() {
  awk -F'\t' '
    function valid_role(name) {
      if (name ~ /^cms_platform_[a-z][a-z0-9]*$/) return 1
      if (name == "cms_admin_login") return 1
      if (name ~ /^cms_admin_(read|write|operate|account)_[a-z][a-z0-9]*$/) return 1
      return 0
    }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      if (NF != 4) {
        printf "%s:%d: expected 4 tab-separated fields (role, login, bypassrls, comment), got %d\n", FILENAME, FNR, NF > "/dev/stderr"
        rc = 1
        next
      }
      if (NF == 4 && $4 == "") {
        printf "%s:%d: empty comment for role %s — every role states why it exists\n", FILENAME, FNR, $1 > "/dev/stderr"
        rc = 1
      }
      if (!valid_role($1)) {
        printf "%s:%d: role %s is outside the contract (cms_platform_<capability> or cms_admin_<capability>_<domain>)\n", FILENAME, FNR, $1 > "/dev/stderr"
        rc = 1
      }
      if ($2 != "yes" && $2 != "no") {
        printf "%s:%d: login must be yes or no, got [%s]\n", FILENAME, FNR, $2 > "/dev/stderr"
        rc = 1
      }
      if ($3 != "yes" && $3 != "no") {
        printf "%s:%d: bypassrls must be yes or no, got [%s]\n", FILENAME, FNR, $3 > "/dev/stderr"
        rc = 1
      }
      if ($1 in seen) {
        printf "%s:%d: duplicate role %s\n", FILENAME, FNR, $1 > "/dev/stderr"
        rc = 1
      }
      seen[$1] = 1
      count++
    }
    END {
      if (count == 0) {
        printf "%s: no role rows — refusing to render an empty catalog\n", FILENAME > "/dev/stderr"
        rc = 1
      }
      exit rc
    }
  ' "$CATALOG" || log_die "catalog.tsv failed validation" 1
}

# The roles file lets the grants pass answer "is this role in the catalog?" without a second parser.
validate_grants() {
  awk -F'\t' '
    BEGIN { valid = 1 }
    function is_admin(name) { return name ~ /^cms_admin_/ }
    NR == FNR {
      if ($0 ~ /^[[:space:]]*#/ || $0 ~ /^[[:space:]]*$/) next
      catalog[$1] = 1
      next
    }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      if (NF != 5) {
        printf "%s:%d: expected 5 tab-separated fields (role, table, privilege, columns, sequence), got %d\n", FILENAME, FNR, NF > "/dev/stderr"
        valid = 0
        next
      }
      if (!($1 in catalog)) {
        printf "%s:%d: role %s is not in catalog.tsv — a grant to an unlisted role is a typo\n", FILENAME, FNR, $1 > "/dev/stderr"
        valid = 0
      }
      if (!is_admin($1)) {
        printf "%s:%d: %s is not an admin role — this slice renders column grants for admin roles only\n", FILENAME, FNR, $1 > "/dev/stderr"
        valid = 0
      }
      if ($2 !~ /^[a-z][a-z0-9_]*$/) {
        printf "%s:%d: table [%s] is not a bare lowercase identifier\n", FILENAME, FNR, $2 > "/dev/stderr"
        valid = 0
      }
      if ($3 != "SELECT" && $3 != "UPDATE" && $3 != "INSERT" && $3 != "DELETE") {
        printf "%s:%d: privilege [%s] must be SELECT, UPDATE, INSERT or DELETE\n", FILENAME, FNR, $3 > "/dev/stderr"
        valid = 0
      }
      if ($3 == "DELETE") {
        if ($4 != "-") {
          printf "%s:%d: DELETE takes no column list; use - (PostgreSQL has no column form for it)\n", FILENAME, FNR > "/dev/stderr"
          valid = 0
        }
      } else if ($4 !~ /^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*)*$/) {
        printf "%s:%d: columns [%s] must be a comma-separated list of bare lowercase column names\n", FILENAME, FNR, $4 > "/dev/stderr"
        valid = 0
      }
      if ($3 == "INSERT") {
        if ($5 != "-" && $5 !~ /^[a-z][a-z0-9_]*$/) {
          printf "%s:%d: sequence [%s] must be a bare lowercase identifier or -\n", FILENAME, FNR, $5 > "/dev/stderr"
          valid = 0
        }
      } else if ($5 != "-") {
        printf "%s:%d: a sequence belongs to an INSERT row; %s does not advance one\n", FILENAME, FNR, $3 > "/dev/stderr"
        valid = 0
      }
      key = $1 SUBSEP $2 SUBSEP $3
      if (key in seen) {
        printf "%s:%d: duplicate grant %s %s (%s)\n", FILENAME, FNR, $3, $2, $1 > "/dev/stderr"
        valid = 0
      }
      seen[key] = 1
      count++
    }
    END {
      if (count == 0) {
        printf "%s: no grant rows — refusing to render policies with no grants behind them\n", FILENAME > "/dev/stderr"
        valid = 0
      }
      exit(valid ? 0 : 1)
    }
  ' "$CATALOG" "$GRANTS" || log_die "grants.tsv failed validation" 1
}

validate_catalog
validate_grants

role_count=$(awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ {c++} END {print c+0}' "$CATALOG")
platform_count=$(awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ && $1 ~ /^cms_platform_/ {c++} END {print c+0}' "$CATALOG")
grant_count=$(awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ {c++} END {print c+0}' "$GRANTS")
sequence_count=$(awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ && $5 != "-" {c++} END {print c+0}' "$GRANTS")

# ── Rendering ────────────────────────────────────────────────────────────────────────────────
# Header first: the operator who finds this file in psql needs the two commands that reproduce it
# and the list of things it deliberately leaves undone, in the file itself.
emit_header() {
  printf '%s\n' \
    '-- 20260820110000_generated_roles.sql — GENERATED — do not hand-edit' \
    '-- Source: admin-panel/prisma/roles/catalog.tsv + admin-panel/prisma/roles/grants.tsv' \
    '-- Generator: scripts/__generate_role_sql.sh' \
    "-- To regenerate: ${REGEN_CMD}" \
    "-- To verify freshness (CI): ${CHECK_CMD}" \
    "-- Scope: ${role_count} roles (${platform_count} platform, $((role_count - platform_count)) admin) · ${grant_count} table grants · ${sequence_count} sequence grant · ${grant_count} policies on public.admins" \
    '--' \
    '-- WHY this file exists: WS-75 gives each capability its own database identity instead of every' \
    '-- module sharing one, so a bug in one module stops being a grant on the whole database. This is' \
    '-- the foundation slice: the role catalog, plus the column grants and RLS policies for `admins`,' \
    '-- the table whose matrix was exercised against a real database before it was written down.' \
    '--' \
    '-- WHAT IT DELIBERATELY LEAVES UNDONE, because each omission is what makes it safe to apply to a' \
    '-- production schema with the application running:' \
    '--   * table ownership is untouched and nothing is taken away from the role the app uses today,' \
    '--     so the running services keep working exactly as they do now;' \
    '--   * no password: every LOGIN role is created with PASSWORD NULL, so no secret enters the' \
    '--     repository, and the secret step is the only thing that sets a credential;' \
    '--   * no BYPASSRLS: catalog.tsv records that cms_platform_backup wants it, but creating a' \
    '--     bypassing role needs superuser, and the running backup path is still cms_backup;' \
    '--   * no grants outside `admins`: every other domain follows in the slice that proves its' \
    '--     columns against the same rehearsal.' \
    '--' \
    '-- SAFETY: a policy is scoped `TO` one role, so these cannot widen what any other role reads.' \
    '-- For a cms_admin_* role the column grants are the boundary; the policy only admits rows it may' \
    '-- already see. No process connects as these roles until the panel holds one connection per role,' \
    '-- so applying this changes no current behavior.' \
    '--' \
    '-- WHY role creation tolerates insufficient_privilege but grants do not: `make prisma-sync`' \
    '-- re-applies this directory as the application role, which is NOCREATEROLE once the hardening' \
    '-- migration has run, and a re-apply must never abort a restart. If a role is absent for that' \
    '-- reason each grant block says so and does nothing, because a role that does not exist cannot be' \
    '-- granted to. A privilege error on a role that DOES exist aborts the apply: a role without its' \
    '-- policy reads zero rows, and zero rows reads as a missing record, not as a permission error.'
}

# Roles as one VALUES list, in catalog order. WHY a loop and not one DO block per role: the file then
# reads as the catalog it came from, and a reviewer can diff the two by eye.
emit_roles() {
  printf '\n'
  printf '%s\n' \
    '-- ── Roles ────────────────────────────────────────────────────────────────────────────────' \
    '-- One row per catalog.tsv entry, in catalog order. The trailing note is the catalog comment,' \
    '-- so the file still says why each role exists. An existing role is left alone: its attributes' \
    '-- belong to whoever created it, and changing them here could lock a live connection out.'
  printf 'DO $$\nDECLARE\n  r record;\nBEGIN\n  FOR r IN\n    SELECT * FROM (VALUES\n'
  awk -F'\t' '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      n++
      rows[n] = sprintf("      (%c%s%c, %c%s%c)", 39, $1, 39, 39, ($2 == "yes" ? "LOGIN" : "NOLOGIN"), 39)
      notes[n] = $4
    }
    END {
      for (i = 1; i <= n; i++) {
        printf "%-58s-- %s\n", rows[i] (i < n ? "," : ""), notes[i]
      }
    }
  ' "$CATALOG"
  printf '%s\n' \
    '    ) AS v(role, login)' \
    '  LOOP' \
    '    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role) THEN' \
    '      BEGIN' \
    "        EXECUTE format('CREATE ROLE %I %s PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', r.role, r.login);" \
    '      EXCEPTION WHEN insufficient_privilege THEN' \
    "        RAISE NOTICE 'role % not created: the applier lacks CREATEROLE (it exists after the first apply)', r.role;" \
    '      END;' \
    '    ELSE' \
    "      RAISE NOTICE 'role % exists: attributes left untouched', r.role;" \
    '    END IF;' \
    '  END LOOP;' \
    'END $$;'
}

# Distinct (role, table) pairs in first-appearance order: one block each, so a future slice that
# adds a second table to a role needs no change here.
grant_groups() {
  awk -F'\t' '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    !seen[$1 SUBSEP $2]++ { printf "%s\t%s\n", $1, $2 }
  ' "$GRANTS"
}

# Rows of one group, privileges in the order PostgreSQL applies them. SELECT first is deliberate:
# it is the verb every writer also needs, so reading the block top-down shows the dependency.
group_rows() {
  awk -F'\t' -v role="$1" -v tbl="$2" '
    BEGIN { rank["SELECT"] = 1; rank["UPDATE"] = 2; rank["INSERT"] = 3; rank["DELETE"] = 4 }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    $1 == role && $2 == tbl { printf "%d\t%s\t%s\t%s\t%s\n", rank[$3], $1, $3, $4, $5 }
  ' "$GRANTS" | LC_ALL=C sort -t "$(printf '\t')" -k1,1n | cut -f2-
}

# `a,b` -> `a, b`: the rendered GRANT is read far more often than it is written, and a comma with no
# space after a column name reads as a typo in every SQL style this repository uses.
spaced_columns() {
  printf '%s\n' "$1" | awk -F',' 'BEGIN { OFS = ", " } { $1 = $1; print }'
}

emit_grants() {
  printf '\n'
  printf '%s\n' \
    '-- ── Column grants and RLS policies: public.admins ────────────────────────────────────────' \
    '-- One block per role. Each block applies its grants and then the policies for exactly those' \
    '-- verbs, so a grant can never exist without the policy that makes it visible.' \
    '--' \
    '-- WHY every writer also carries SELECT: `UPDATE ... WHERE username = ...` looks the row up' \
    '-- under the SELECT policy, and Prisma writes with INSERT ... RETURNING, which PostgreSQL' \
    '-- refuses when the new row is not visible to the writer. A role granted UPDATE alone updates' \
    '-- zero rows and reports success — the failure this catalog exists to make impossible.' \
    '--' \
    '-- WHY USING (true): the reach of each role is its column list, not a row predicate. Row-level' \
    '-- narrowing per admin arrives with the panel wiring, when the panel can announce an actor.' \
    '-- A bare `true` here therefore grants nothing a column grant has not already granted.' \
    '--' \
    '-- WHY the INSERT role also gets USAGE on the sequence behind admins.id: PostgreSQL checks' \
    '-- nextval() against the sequence, not the table, so a table grant alone leaves the create path' \
    '-- failing with a privilege error that names a different object than the one being written.'
  local role tbl verbs verb policy row_role
  while IFS=$'\t' read -r role tbl; do
    [ -n "$role" ] || continue
    printf '\n-- %s on public.%s\n' "$role" "$tbl"
    printf 'DO $$\nBEGIN\n'
    printf "  IF to_regclass('public.%s') IS NULL THEN\n    RAISE NOTICE 'public.%s is missing: no grants applied for %s';\n    RETURN;\n  END IF;\n" \
      "$tbl" "$tbl" "$role"
    printf "  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN\n    RAISE NOTICE '%s is missing: no grants applied for it';\n    RETURN;\n  END IF;\n" \
      "$role" "$role"
    verbs=""
    while IFS=$'\t' read -r row_role verb columns sequence; do
      [ -n "$row_role" ] || continue
      if [ "$verb" = "DELETE" ]; then
        printf "  EXECUTE 'GRANT DELETE ON public.%s TO %s';\n" "$tbl" "$role"
      else
        printf "  EXECUTE 'GRANT %s (%s) ON public.%s TO %s';\n" "$verb" "$(spaced_columns "$columns")" "$tbl" "$role"
      fi
      if [ "$verb" = "INSERT" ] && [ "$sequence" != "-" ]; then
        printf "  IF to_regclass('public.%s') IS NOT NULL THEN\n    EXECUTE 'GRANT USAGE ON SEQUENCE public.%s TO %s';\n  ELSE\n    RAISE NOTICE 'public.%s is missing: %s cannot allocate a new public.%s row';\n  END IF;\n" \
          "$sequence" "$sequence" "$role" "$sequence" "$role" "$tbl"
      fi
      verbs="${verbs}${verb} "
    done < <(group_rows "$role" "$tbl")
    for verb in SELECT UPDATE INSERT DELETE; do
      case " $verbs " in *" $verb "*) ;; *) continue ;; esac
      policy="${role}_${verb,,}"
      printf "  EXECUTE 'DROP POLICY IF EXISTS %s ON public.%s';\n" "$policy" "$tbl"
      if [ "$verb" = "UPDATE" ]; then
        printf "  EXECUTE 'CREATE POLICY %s ON public.%s FOR UPDATE TO %s USING (true) WITH CHECK (true)';\n" "$policy" "$tbl" "$role"
      elif [ "$verb" = "SELECT" ]; then
        printf "  EXECUTE 'CREATE POLICY %s ON public.%s FOR SELECT TO %s USING (true)';\n" "$policy" "$tbl" "$role"
      elif [ "$verb" = "INSERT" ]; then
        printf "  EXECUTE 'CREATE POLICY %s ON public.%s FOR INSERT TO %s WITH CHECK (true)';\n" "$policy" "$tbl" "$role"
      else
        printf "  EXECUTE 'CREATE POLICY %s ON public.%s FOR DELETE TO %s USING (true)';\n" "$policy" "$tbl" "$role"
      fi
    done
    printf 'END $$;\n'
  done < <(grant_groups)
}

render() {
  emit_header
  emit_roles
  emit_grants
}

# ── Verdict ──────────────────────────────────────────────────────────────────────────────────
# A duplicate here would mean two policies share a (table, name) pair, which PostgreSQL rejects at
# apply time — far too late to discover in a restart. Checked on the rendered text so a future
# naming scheme cannot collide silently.
check_duplicate_policies() {
  local rendered="$1" dups
  dups=$(grep -oE "CREATE POLICY [a-z0-9_]+ ON public\.[a-z0-9_]+" "$rendered" \
    | sed 's/^CREATE POLICY //' | LC_ALL=C sort | uniq -d)
  if [ -n "$dups" ]; then
    printf '[FAIL] duplicate policy name(s) in the rendered SQL:\n' >&2
    printf '  %s\n' "$dups" >&2
    exit 1
  fi
}

case "$MODE" in
  print)
    render
    ;;
  write)
    fresh="${tmpdir}/generated.sql"
    render > "$fresh"
    check_duplicate_policies "$fresh"
    mkdir -p "$(dirname -- "$OUT")"
    cp "$fresh" "$OUT"
    log_info "wrote ${OUT#"${REPO_ROOT}/"} — ${role_count} roles, ${grant_count} grants, ${grant_count} policies" >&2
    ;;
  check)
    if [ ! -f "$OUT" ]; then
      printf '[FAIL] %s is missing — the generated SQL is not in the tree\n' "${OUT#"${REPO_ROOT}/"}" >&2
      printf '  regenerate: %s\n' "$REGEN_CMD" >&2
      exit 1
    fi
    fresh="${tmpdir}/generated.sql"
    render > "$fresh"
    check_duplicate_policies "$fresh"
    if ! diff -u "$OUT" "$fresh" > "${tmpdir}/drift.diff" 2>&1; then
      printf '[FAIL] %s is stale — it does not match the catalog and grants it is generated from:\n' "${OUT#"${REPO_ROOT}/"}" >&2
      sed -n '1,200p' "${tmpdir}/drift.diff" | sed 's/^/  /' >&2
      printf '  regenerate: %s\n' "$REGEN_CMD" >&2
      exit 1
    fi
    log_info "role SQL is fresh — ${role_count} roles, ${grant_count} grants, ${grant_count} policies" >&2
    ;;
esac
