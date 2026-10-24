#!/usr/bin/env bash
# tests/test_rls_actor_enforcement.sh — RLS enforces the actor, and fails closed without one.
#
# WHY this suite exists: the policies used to be `USING (true)`, so "row-level security" enforced
# nothing and the only thing standing between an unauthenticated code path and the whole database
# was application code. This suite proves the database itself now refuses, by running THE SAME query
# twice — once with `cms.actor` set inside the transaction, once without — against the policy SQL
# that is actually committed, not a paraphrase of it.
#
# WHAT it proves, in order:
#   1. no actor  -> zero rows, and an INSERT is refused outright;
#   2. an actor  -> the rows;
#   3. the setting does not survive the transaction (the pooled-connection leak this design exists
#      to prevent);
#   4. a superuser or BYPASSRLS role bypasses everything — which is why the app role is demoted,
#      and why the suite asserts the role's attributes as its first check;
#   5. a table whose SELECT is deliberately public (the ranking board) still refuses writes without
#      an actor, so "public read" did not become "public everything";
#   6. an admin cannot file an audit row attributed to a different admin.
#
# HOW it isolates: it creates its own schema-less tables in `public` inside the database you point
# it at, under the `cmsuser` name the policies are written against, and drops them on exit. Point it
# at a scratch database, never at a contest's.
#
# RUN: CMS_RLS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/cmsdb bash tests/test_rls_actor_enforcement.sh
# Without that variable it skips (exit 0) — CI has no database, and a suite that fails for
# "no server" teaches people to ignore it.
set -u

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$REPO_ROOT/admin-panel/prisma/migrations/20261025120000_rls_actor_policies/migration.sql"
PSQL="${PSQL:-psql}"

pass=0
fail=0
ok() { printf '  [ok]   %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  [FAIL] %s\n' "$1"; fail=$((fail + 1)); }

if [ -z "${CMS_RLS_TEST_DATABASE_URL:-}" ]; then
  printf 'SKIP: set CMS_RLS_TEST_DATABASE_URL to a scratch database to run the RLS enforcement suite\n'
  exit 0
fi
command -v "${PSQL%% *}" >/dev/null 2>&1 || { printf 'SKIP: %s not on PATH\n' "${PSQL%% *}"; exit 0; }
[ -f "$MIGRATION" ] || { printf '[FAIL] missing policy migration %s\n' "$MIGRATION"; exit 1; }

URL="$CMS_RLS_TEST_DATABASE_URL"

# -X ignores ~/.psqlrc, -v ON_ERROR_STOP=0 keeps a refusal from aborting the whole script, and -tA
# makes the output comparable. Individual probes turn ON_ERROR_STOP on where a refusal is expected.
run() { $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c "$1" 2>&1; }
run_strict() { $PSQL "$URL" -X -tA -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

cleanup() {
  run "DROP TABLE IF EXISTS public.contests, public.users, public.audit_log, public.ranking_config, public.security_findings, public.admins CASCADE;" >/dev/null 2>&1
  run "DROP FUNCTION IF EXISTS public.cms_actor_is_staff_or_auth(); DROP FUNCTION IF EXISTS public.cms_actor_is_staff(); DROP FUNCTION IF EXISTS public.cms_actor_any(text[]); DROP FUNCTION IF EXISTS public.cms_actor_admin_id(); DROP FUNCTION IF EXISTS public.cms_actor();" >/dev/null 2>&1
  run "REVOKE ALL ON SCHEMA public FROM cmsuser;" >/dev/null 2>&1
}
trap cleanup EXIT

printf '== RLS actor enforcement ==\n'

# ── 0. The role, and what it is allowed to bypass ────────────────────────────────────────────
# WHY first: if cmsuser were a superuser or had BYPASSRLS, every assertion below would pass for the
# wrong reason — or rather, none of them would fail, and the whole change would protect nothing.
run "DROP ROLE IF EXISTS cmsuser;" >/dev/null 2>&1
if ! run_strict "CREATE ROLE cmsuser NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB LOGIN PASSWORD 'cms';" >/dev/null; then
  printf '[FAIL] could not create the cmsuser role (needs a superuser connection)\n'
  exit 1
fi
attrs=$(run "SELECT rolsuper || '|' || rolbypassrls FROM pg_roles WHERE rolname = 'cmsuser';")
if [ "$attrs" = "false|false" ]; then
  ok "cmsuser is NOSUPERUSER and NOBYPASSRLS, so RLS applies to it"
else
  bad "cmsuser attributes are $attrs — a superuser or BYPASSRLS role ignores every policy"
fi
run_strict "GRANT USAGE, CREATE ON SCHEMA public TO cmsuser;" >/dev/null

# ── 1. The fixture: the real columns these policies reference ────────────────────────────────
run_strict "CREATE TABLE public.contests (id int PRIMARY KEY, name varchar);" >/dev/null
run_strict "CREATE TABLE public.users (id int PRIMARY KEY, username varchar);" >/dev/null
run_strict "CREATE TABLE public.audit_log (id bigint PRIMARY KEY, actor_id int, verb varchar);" >/dev/null
run_strict "CREATE TABLE public.ranking_config (id int PRIMARY KEY, target_kind varchar);" >/dev/null
run_strict "CREATE TABLE public.security_findings (id int PRIMARY KEY, source varchar);" >/dev/null
run_strict "CREATE TABLE public.admins (id int PRIMARY KEY, username varchar, enabled boolean);" >/dev/null
run_strict "ALTER TABLE public.contests OWNER TO cmsuser; ALTER TABLE public.users OWNER TO cmsuser; ALTER TABLE public.audit_log OWNER TO cmsuser; ALTER TABLE public.ranking_config OWNER TO cmsuser; ALTER TABLE public.security_findings OWNER TO cmsuser; ALTER TABLE public.admins OWNER TO cmsuser;" >/dev/null
run_strict "ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY; ALTER TABLE public.contests FORCE ROW LEVEL SECURITY; ALTER TABLE public.users ENABLE ROW LEVEL SECURITY; ALTER TABLE public.users FORCE ROW LEVEL SECURITY; ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY; ALTER TABLE public.ranking_config ENABLE ROW LEVEL SECURITY; ALTER TABLE public.ranking_config FORCE ROW LEVEL SECURITY; ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.security_findings FORCE ROW LEVEL SECURITY; ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY; ALTER TABLE public.admins FORCE ROW LEVEL SECURITY;" >/dev/null
# Seeded by the superuser before RLS is switched on, so the fixture does not need an actor to exist.
run_strict "INSERT INTO public.contests VALUES (1,'c1'),(2,'c2'); INSERT INTO public.users VALUES (1,'u1'),(2,'u2'); INSERT INTO public.ranking_config VALUES (1,'contest');" >/dev/null

# ── 2. Apply the COMMITTED policy SQL, extracted from the migration itself ───────────────────
# WHY extract rather than restate: a suite that retypes the predicate proves the predicate it
# retyped, not the one in production. If the migration changes, this applies the change.
# WHY the terminator is matched with leading whitespace: the generator indents the closing
# `$$;`, so an anchored pattern would run past the last function and swallow every policy block
# in the file — which is how this extraction silently became "apply the whole migration".
HELPERS=$(awk '
  /^CREATE OR REPLACE FUNCTION/ { f = 1 }
  f { print }
  f && /^[[:space:]]*\$\$;$/ { f = 0 }
' "$MIGRATION")
if [ -z "$HELPERS" ]; then
  printf '[FAIL] could not extract the helper functions from %s\n' "$MIGRATION"
  exit 1
fi

block() {
  awk -v want="-- $1" '
    $0 == want { f = 1 }
    f && /^$/ { exit }
    f { print }
  ' "$MIGRATION"
}

ALL_SQL="$HELPERS"
for table in contests users audit_log ranking_config security_findings admins; do
  one=$(block "$table")
  if [ -z "$one" ]; then
    printf '[FAIL] no committed policy block for %s in %s\n' "$table" "$MIGRATION"
    exit 1
  fi
  ALL_SQL="$ALL_SQL
$one"
done

if printf '%s\n' "$ALL_SQL" | $PSQL "$URL" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  ok "the committed policy SQL applies to every table this suite exercises"
else
  printf '%s\n' "$ALL_SQL" | $PSQL "$URL" -X -q -v ON_ERROR_STOP=1 2>&1 | sed 's/^/    /'
  bad "the committed policy SQL did not apply — the generator and the migration disagree"
  exit 1
fi

# Every probe below runs as cmsuser, the role the policies are written for.
as_cmsuser() { run "SET ROLE cmsuser; $1"; }

# ── 3. Fail closed: no actor ─────────────────────────────────────────────────────────────────
count=$(as_cmsuser "SELECT count(*) FROM public.contests;" | tail -1)
if [ "$count" = "0" ] && [ -n "$count" ]; then
  ok "no actor: SELECT over contests returns 0 rows (fail closed, not fail open)"
else
  bad "no actor: SELECT over contests returned '$count' rows — the policy is permissive"
fi

insert_refused=$(run "SET ROLE cmsuser; INSERT INTO public.contests VALUES (99,'nope');")
if printf '%s' "$insert_refused" | grep -qi "row-level security"; then
  ok "no actor: INSERT into contests is refused by the policy"
else
  bad "no actor: INSERT into contests was accepted or failed for another reason: $insert_refused"
fi

# ── 4. The same query with the actor ────────────────────────────────────────────────────────
count=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:7', true); SELECT count(*) FROM public.contests; COMMIT;" | grep -E '^[0-9]+$' | tail -1)
if [ "$count" = "2" ]; then
  ok "admin:7 sees both contest rows through the identical query"
else
  bad "admin:7 saw '$count' rows, expected 2"
fi

count=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'system:core', true); SELECT count(*) FROM public.contests; COMMIT;" | grep -E '^[0-9]+$' | tail -1)
if [ "$count" = "2" ]; then
  ok "system:core (the Python core) sees the same rows"
else
  bad "system:core saw '$count' rows, expected 2"
fi

# ── 5. The setting is transaction-local, so a pooled connection cannot leak it ──────────────
# One session, two transactions: the first sets the actor, the second must not inherit it. This is
# the assertion that would fail if the implementation used `SET` instead of `SET LOCAL`.
leak=$(run "SET ROLE cmsuser;
BEGIN; SELECT set_config('cms.actor', 'admin:7', true); SELECT count(*) FROM public.contests; COMMIT;
BEGIN; SELECT count(*) FROM public.contests; COMMIT;" | grep -E '^[0-9]+$' | tr '\n' ',')
if [ "$leak" = "2,0," ]; then
  ok "the actor is transaction-local: the next transaction on the same session sees 0 rows"
else
  bad "actor leaked across transactions on one session (saw $leak) — a pooled connection would"
fi

# ── 6. A superuser connection bypasses RLS entirely (the reason cmsuser is demoted) ─────────
# Asserted, not assumed: this is the finding that decides whether any of the above protects
# anything in production.
bypass=$(run "SELECT count(*) FROM public.contests;")
if [ "$bypass" = "2" ]; then
  ok "a superuser connection bypasses the policy (so the app role must never be one)"
else
  bad "expected the superuser connection to bypass RLS and read 2 rows, saw '$bypass'"
fi

# ── 7. Public-read tables: SELECT open, writes gated ───────────────────────────────────────
pub=$(as_cmsuser "SELECT count(*) FROM public.ranking_config;" | tail -1)
if [ "$pub" = "1" ]; then
  ok "ranking_config is readable with no actor (the anonymous board reads it)"
else
  bad "ranking_config returned '$pub' rows with no actor; the public board would draw nothing"
fi

pub_write=$(run "SET ROLE cmsuser; INSERT INTO public.ranking_config VALUES (2,'contest');")
if printf '%s' "$pub_write" | grep -qi "row-level security"; then
  ok "ranking_config still refuses a write with no actor"
else
  bad "ranking_config accepted an actor-less write: $pub_write"
fi

# ── 8. audit_log: append-only, and an admin cannot forge an attribution ─────────────────────
own=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:7', true); INSERT INTO public.audit_log VALUES (1, 7, 'x'); COMMIT;")
if ! printf '%s' "$own" | grep -qi "row-level security"; then
  ok "admin:7 may append an audit row attributed to itself"
else
  bad "admin:7 could not append its own audit row: $own"
fi

forged=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:7', true); INSERT INTO public.audit_log VALUES (2, 9, 'x'); COMMIT;")
if printf '%s' "$forged" | grep -qi "row-level security"; then
  ok "admin:7 cannot file an audit row attributed to admin 9"
else
  bad "admin:7 filed an audit row naming another admin: $forged"
fi

update_refused=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:7', true); UPDATE public.audit_log SET verb = 'y' WHERE id = 1; COMMIT;")
if printf '%s' "$update_refused" | grep -qE "row-level security|UPDATE 0"; then
  ok "audit_log stays append-only: no UPDATE policy exists"
else
  bad "audit_log UPDATE was accepted: $update_refused"
fi

# ── 9. The ingest identity is the only one that may append a finding ───────────────────────
ingest=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'system:ingest', true); INSERT INTO public.security_findings VALUES (1, 'diun'); COMMIT;")
if ! printf '%s' "$ingest" | grep -qi "row-level security"; then
  ok "system:ingest may append a finding"
else
  bad "system:ingest could not append a finding: $ingest"
fi

admin_ingest=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:7', true); INSERT INTO public.security_findings VALUES (2, 'diun'); COMMIT;")
if ! printf '%s' "$admin_ingest" | grep -qi "row-level security"; then
  ok "an admin may also append (staff is in the findings allowlist)"
else
  bad "an admin could not append a finding: $admin_ingest"
fi

# ── 10. A malformed claim authenticates as nobody ──────────────────────────────────────────
garbage=$(run "SET ROLE cmsuser; BEGIN; SELECT set_config('cms.actor', 'admin:not-a-number', true); SELECT count(*) FROM public.contests; COMMIT;" | grep -E '^[0-9]+$' | tail -1)
if [ "$garbage" = "0" ]; then
  ok "a malformed cms.actor value matches no predicate (it does not throw, it denies)"
else
  bad "a malformed cms.actor yielded '$garbage' rows"
fi

printf '\n== %d passed, %d failed ==\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
