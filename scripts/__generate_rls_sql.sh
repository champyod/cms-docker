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
EMIT_POLICIES=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --write) WRITE=1 ;;
    --write=*) WRITE=1; WRITE_NAME="${arg#--write=}" ;;
    --emit-policies) EMIT_POLICIES=1 ;;
    --help|-h) printf 'Usage: %s [--check] [--write[=name]] [--emit-policies]\n' "$0"; exit 0 ;;
    *) log_die "unknown arg: $arg" 2 ;;
  esac
done

# The directory name must use Prisma's own characters (lexical apply order).
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

# LC_ALL=C everywhere: locale-dependent collation would reorder blocks and change the verdict.
# Duplicate names after @@map resolution are fatal rather than silently deduped.
if [ "$(LC_ALL=C sort "$tmp_models" | uniq -d | wc -l | tr -d ' ')" -ne 0 ]; then
  dup=$(LC_ALL=C sort "$tmp_models" | uniq -d | tr '\n' ' ')
  log_die "duplicate table names after @@map resolution: $dup" 1
fi

# Collect every table with ENABLE ROW LEVEL SECURITY in migration history, via either form.
# Sorts stay LC_ALL=C so comm agrees with the C-ordered migration history.
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

# ── Policy classification — the single source of truth for every predicate ────────────────
#
# WHY a classification and not a per-table judgment at authoring time: the generator is what the
# repo rule makes authoritative ("policies come from the generator, never hand-written twice"), so
# the rule for a table has to live HERE, once, and the committed migration is only ever a rendering
# of it. --check diffs the committed rendering against a fresh one, so a table that gains a column
# or a model cannot keep a stale predicate.
#
# WHAT the default is: a table named in no list gets EVERY verb gated on an identified actor. That
# is the fail-closed direction — a new model is enforced by default and cannot be silently
# permissive, which is the defect this change exists to close.
#
# The three lists below are the only exceptions, and each one is an argued exception:
#
# PUBLIC_BOARD_READ — the public ranking board (ranking-web) reads these over the SAME cmsuser
#   connection the panel and the core use (docker-compose passes it one DATABASE_URL), and it
#   serves them to anonymous visitors, so it has no identity to set and no way to set one without
#   changing that service. SELECT therefore stays open on exactly these tables. This is the public
#   surface by design, not a hole: every WRITE to them still requires an actor, which is what
#   closes "an authorization bug is a full data-access bug" for the ranking control plane.
#   Verified against ranking-web/src/store*.rs: that is the whole read set, plus one UPDATE
#   (admins.last_login_at in store/admin.rs:93) called out separately below.
#
# AUTH_BOOTSTRAP — the pre-session login path must read these BEFORE it knows who the actor is
#   (admins to verify a credential, groups/permissions to resolve grants, login_surfaces to draw
#   the form). It announces itself as system:auth; nothing else may use that identity.
#
# INGEST_WRITE — the security-feed container pushes findings over the panel's HTTP API and is
#   attributed to the seeded root admin; it announces itself as system:ingest and may only INSERT
#   and UPDATE here.
PUBLIC_BOARD_READ=" admin_groups admin_permission_overrides admins group_permissions permissions ranking_config ranking_contests ranking_hidden ranking_overrides ranking_settings ranking_subchanges ranking_submissions ranking_tasks ranking_teams ranking_users services "
AUTH_BOOTSTRAP=" admin_groups admin_permission_overrides admins group_permissions groups login_surfaces permissions "
INGEST_WRITE=" security_findings "
# WHY admins is neither strict nor plain public-read: the ranking console stamps last_login_at on
# its own login (store/admin.rs:93) with no identity, so UPDATE stays open there while INSERT and
# DELETE (create/remove an admin) require staff. Column-level narrowing is not something RLS can
# express, so this is the narrowest rule the verb set allows.
CONSOLE_LOGIN_UPDATE=" admins "
# AUDIT_RETENTION — the one identity allowed to shorten the audit log (see the audit_log branch
# below). It is deliberately NOT in the staff set: it may read the log and delete rows past the
# window, and nothing else. The trigger in 20261026120100_audit_log_durable enforces the window
# even for this identity, so the grant is a shape, not a licence.
AUDIT_RETENTION="system:audit-retention"

in_list() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# The actor predicate for a table's read side. Strict tables and the write side of public-read
# tables share it; AUTH_BOOTSTRAP widens it by exactly one identity.
read_predicate() {
  local tbl="$1"
  if in_list "$tbl" "$AUTH_BOOTSTRAP"; then
    printf 'public.cms_actor_is_staff_or_auth()'
  else
    printf 'public.cms_actor_is_staff()'
  fi
}

emit_policy_helpers() {
  cat <<'SQL'
-- ── Actor identity, read from the transaction-local GUC the application sets ───────────────
-- WHY current_setting(..., true): the missing_ok form returns NULL instead of raising when the
-- GUC is unset, so an actor-less connection reads as "no actor" (and every predicate below is
-- false) rather than erroring the whole query out. Fail closed, not fail loud, at the row level.
-- WHY every helper below carries `SET search_path`: a plain SQL function this simple is INLINED
-- into the policy expression, so `cms_actor_is_staff()` was re-evaluated once per row — a regex,
-- two split_parts and two array comparisons times 34,610 rows, on every query in the panel.
-- Measured: 25 ms of a 55 ms GROUP BY. A function with a SET clause cannot be inlined, so the
-- identity is resolved once per statement. The search_path is pinned at the same time, which is
-- the other half of what makes these safe to call from a policy.
CREATE OR REPLACE FUNCTION public.cms_actor() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT nullif(current_setting('cms.actor', true), '')
  $$;

-- Only the exact shape `admin:<decimal>` yields an id. Anything else (a malformed value, a system
-- identity) is NULL, so a forged or truncated GUC cannot name an admin.
CREATE OR REPLACE FUNCTION public.cms_actor_admin_id() RETURNS integer
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT CASE
             WHEN public.cms_actor() ~ '^admin:[0-9]{1,9}$'
             THEN split_part(public.cms_actor(), ':', 2)::integer
           END
  $$;

-- A system identity must carry the `system:` prefix AND be named here. The prefix check is what
-- keeps `admin:7` out of the allowlist even if a name collided with it.
CREATE OR REPLACE FUNCTION public.cms_actor_any(names text[]) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor() LIKE 'system:%' AND public.cms_actor() = ANY(names)
  $$;

-- The trusted application identities: a signed-in panel admin, the Python core, the panel's CLI,
-- and migrations/seeding. Everything outside this set is an unidentified connection.
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler'])
  $$;

-- The same set plus the pre-session login path. Used only on AUTH_BOOTSTRAP tables.
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff_or_auth() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler', 'system:auth'])
  $$;
SQL
}

emit_policy_set() {
  printf '%s\n' '-- BEGIN GENERATED POLICY SET (scripts/__generate_rls_sql.sh --emit-policies) — do not hand-edit'
  emit_policy_helpers
  local tbl
  while IFS= read -r tbl; do
    [ -n "$tbl" ] || continue
    printf '\n-- %s\n' "$tbl"
    if in_list "$tbl" "$PUBLIC_BOARD_READ"; then
      printf '%s\n' \
        '-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.' \
        "DROP POLICY IF EXISTS cmsuser_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_public_read ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_write ON public.$tbl;" \
        "CREATE POLICY cms_public_read ON public.$tbl FOR SELECT TO cmsuser USING (true);" \
        "CREATE POLICY cms_actor_write ON public.$tbl FOR ALL TO cmsuser USING ($(read_predicate "$tbl")) WITH CHECK ($(read_predicate "$tbl"));"
      if in_list "$tbl" "$CONSOLE_LOGIN_UPDATE"; then
        printf '%s\n' \
          '-- CONSOLE_LOGIN_UPDATE: the ranking console stamps last_login_at with no identity; only UPDATE is open.' \
          "DROP POLICY IF EXISTS cms_public_update ON public.$tbl;" \
          "CREATE POLICY cms_public_update ON public.$tbl FOR UPDATE TO cmsuser USING (true) WITH CHECK (true);"
      fi
    elif in_list "$tbl" "$INGEST_WRITE"; then
      printf '%s\n' \
        '-- INGEST_WRITE: readable by staff AND the security-feed container, appended and updated by' \
        '-- both too. WHY the reader clause matters as much as the writer: Prisma upserts with' \
        '-- INSERT … RETURNING, and Postgres refuses RETURNING when the new row is not visible under' \
        '-- the SELECT policy (42501 "new row violates row-level security policy"). An ingest identity' \
        '-- that could write but not read its own row failed on every push while the policy looked' \
        '-- correct in isolation.' \
        "DROP POLICY IF EXISTS cmsuser_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_read ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_append ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_update ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_delete ON public.$tbl;" \
        "CREATE POLICY cms_actor_read ON public.$tbl FOR SELECT TO cmsuser USING ($(read_predicate "$tbl") OR public.cms_actor_any(ARRAY['system:ingest']));" \
        "CREATE POLICY cms_actor_append ON public.$tbl FOR INSERT TO cmsuser WITH CHECK ($(read_predicate "$tbl") OR public.cms_actor_any(ARRAY['system:ingest']));" \
        "CREATE POLICY cms_actor_update ON public.$tbl FOR UPDATE TO cmsuser USING ($(read_predicate "$tbl") OR public.cms_actor_any(ARRAY['system:ingest'])) WITH CHECK ($(read_predicate "$tbl") OR public.cms_actor_any(ARRAY['system:ingest']));" \
        "CREATE POLICY cms_actor_delete ON public.$tbl FOR DELETE TO cmsuser USING ($(read_predicate "$tbl"));"
    elif [ "$tbl" = "audit_log" ]; then
      printf '%s\n' \
        '-- AUDIT_LOG: append-only. No UPDATE policy exists and UPDATE is refused by the guard trigger,' \
        '-- so editing a row is not a zero-row no-op for anyone. DELETE is granted to one identity only,' \
        '-- and the trigger refuses it for any row inside the retention window. No admin may forge an' \
        '-- attribution: an admin actor can only file a row under itself (or under nobody); only a system' \
        '-- identity names another.' \
        "DROP POLICY IF EXISTS cmsuser_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_select ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_insert ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_delete ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_read ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_append ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_audit_retention_delete ON public.$tbl;" \
        "CREATE POLICY cms_actor_read ON public.$tbl FOR SELECT TO cmsuser USING (" \
        "  $(read_predicate "$tbl")" \
        "  OR public.cms_actor_any(ARRAY['$AUDIT_RETENTION'])" \
        "  OR public.cms_actor_any(ARRAY['system:ingest'])" \
        ");" \
        "CREATE POLICY cms_actor_append ON public.$tbl FOR INSERT TO cmsuser WITH CHECK (" \
        "  ($(read_predicate "$tbl") OR public.cms_actor_any(ARRAY['system:ingest']))" \
        "  AND (" \
        "    public.cms_actor_admin_id() IS NULL" \
        "    OR actor_id IS NULL" \
        "    OR actor_id = public.cms_actor_admin_id()" \
        "  )" \
        ");" \
        "CREATE POLICY cms_audit_retention_delete ON public.$tbl FOR DELETE TO cmsuser" \
        "  USING (public.cms_actor_any(ARRAY['$AUDIT_RETENTION']));"
    elif [ "$tbl" = "audit_log_retention" ]; then
      printf '%s\n' \
        '-- AUDIT_LOG_RETENTION: the prune ledger. Staff read it; only the retention identity writes it,' \
        '-- because a prune is the one event that must be recorded without a human in the loop. No DELETE' \
        '-- policy exists at all — anchors are the proof a gap was a decision, so nothing may remove them.' \
        "DROP POLICY IF EXISTS cmsuser_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_read ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_append ON public.$tbl;" \
        "CREATE POLICY cms_actor_read ON public.$tbl FOR SELECT TO cmsuser USING (" \
        "  $(read_predicate "$tbl")" \
        "  OR public.cms_actor_any(ARRAY['$AUDIT_RETENTION'])" \
        ");" \
        "CREATE POLICY cms_actor_append ON public.$tbl FOR INSERT TO cmsuser WITH CHECK (" \
        "  $(read_predicate "$tbl")" \
        "  OR public.cms_actor_any(ARRAY['$AUDIT_RETENTION'])" \
        ");"
    else
      printf '%s\n' \
        '-- STRICT: every verb requires an identified actor.' \
        "DROP POLICY IF EXISTS cmsuser_all ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_select ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_insert ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_update ON public.$tbl;" \
        "DROP POLICY IF EXISTS cmsuser_delete ON public.$tbl;" \
        "DROP POLICY IF EXISTS cms_actor_all ON public.$tbl;" \
        "CREATE POLICY cms_actor_all ON public.$tbl FOR ALL TO cmsuser USING ($(read_predicate "$tbl")) WITH CHECK ($(read_predicate "$tbl"));"
    fi
  done < "$tmp_models"
  printf '%s\n' '-- END GENERATED POLICY SET'
}

emit_rls_blocks() {
  while IFS= read -r tbl; do
    [ -n "$tbl" ] || continue
    printf 'DO $$ BEGIN\n'
    printf "  IF to_regclass('public.%s') IS NOT NULL THEN\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY';\n" "$tbl"
    printf "    EXECUTE 'ALTER TABLE public.%s FORCE ROW LEVEL SECURITY';\n" "$tbl"
    # FORCE subjects the cmsuser owner to RLS, so a policy must ride along. The policy is the same
    # one --emit-policies renders for this table, so a new table is enforced, never permissive.
    printf "    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.%s';\n" "$tbl"
    printf "    EXECUTE 'CREATE POLICY cms_actor_all ON public.%s FOR ALL TO cmsuser USING (%s) WITH CHECK (%s)';\n" \
      "$tbl" "$(read_predicate "$tbl")" "$(read_predicate "$tbl")"
    printf '  END IF;\n'
    printf 'END $$;\n'
  done < "$tmp_uncovered"
}

tmp_uncovered=$(mktemp)
tmp_extra=$(mktemp)
trap 'rm -f "$tmp_models" "$tmp_covered" "$tmp_uncovered" "$tmp_extra"' EXIT
LC_ALL=C comm -23 "$tmp_models" "$tmp_covered" > "$tmp_uncovered" || true

# --emit-policies renders the FULL policy set for every model, not only the uncovered ones: it is
# the contract --check diffs the committed migration against, so it must never depend on what
# migration history happens to already cover.
if [ "$EMIT_POLICIES" -eq 1 ]; then
  emit_policy_set
  exit 0
fi

# ── --check: coverage PLUS policy freshness ───────────────────────────────────────────────
# WHY freshness and not only coverage: coverage says "some ENABLE exists somewhere"; it cannot see
# that a table still carries the old permissive body, which is exactly the defect this changed
# generator exists to prevent. So the committed rendering is diffed against a fresh one.
run_check() {
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

  # The committed policy set lives in the newest migration that carries the markers. Newest, not
  # first: a later migration is allowed to supersede an earlier rendering.
  local committed=""
  local f
  for f in $(LC_ALL=C ls -1 "$MIGRATIONS_DIR"/*/migration.sql 2>/dev/null | LC_ALL=C sort -r); do
    if grep -q 'BEGIN GENERATED POLICY SET' "$f"; then
      committed="$f"
      break
    fi
  done

  if [ -z "$committed" ]; then
    printf '[FAIL] RLS policy set — no migration carries the generated policy markers:\n' >&2
    printf '  expected a migration containing "-- BEGIN GENERATED POLICY SET"\n' >&2
    printf '  author one with: bash scripts/__generate_rls_sql.sh --emit-policies\n' >&2
    return 1
  fi

  local fresh committed_only
  fresh=$(mktemp)
  committed_only=$(mktemp)
  emit_policy_set > "$fresh"
  sed -n '/^-- BEGIN GENERATED POLICY SET/,/^-- END GENERATED POLICY SET/p' "$committed" > "$committed_only"
  if ! diff -u "$committed_only" "$fresh" > "$committed_only.diff" 2>&1; then
    printf '[FAIL] RLS policy set is stale — %s does not match the generator:\n' "$committed" >&2
    sed -n '1,200p' "$committed_only.diff" | sed 's/^/  /' >&2
    printf '  regenerate: bash scripts/__generate_rls_sql.sh --emit-policies\n' >&2
    rc=1
  fi
  rm -f "$fresh" "$committed_only" "$committed_only.diff"

  [ "$rc" -eq 0 ] || return 1
  log_info "RLS enable coverage OK ($count tables) · policy set fresh ($committed)"
}

if [ "$CHECK" -eq 1 ]; then
  run_check
  exit $?
fi

if [ ! -s "$tmp_uncovered" ]; then
  if [ "$WRITE" -eq 1 ]; then
    log_info "all $count tables already covered in migration history — nothing to write" >&2
  else
    log_info "all $count tables already covered in migration history — nothing to emit" >&2
  fi
  exit 0
fi

uncovered_count=$(wc -l < "$tmp_uncovered" | tr -d ' ')

# --write creates the directory and header and verifies the file closes every gap.
if [ "$WRITE" -eq 1 ]; then
  # LC_ALL=C keeps the timestamp year off a non-Gregorian host locale (th_TH renders 2026 as 2569).
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
      '-- Mechanical ENABLE/FORCE plus the cmsuser_all policy per table; to_regclass keeps each ALTER safe if prisma db push drops or renames a table.' \
      "-- To regenerate: bash scripts/__generate_rls_sql.sh --write=${WRITE_NAME}" \
      "-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check" \
      ""
    emit_rls_blocks
  } > "${migration_dir}/migration.sql"

  # Re-derive coverage from the written file so the generator verifies its own output.
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
