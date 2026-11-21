#!/usr/bin/env bash
# tests/test_script_db_actor.sh — the host scripts announce who they are, and the write lands.
#
# WHY this suite exists: every table carries FORCE ROW LEVEL SECURITY and its policies read the
# transaction/session GUC `cms.actor`. A host script that connects as cmsuser and says nothing is
# not refused — it reads zero rows and its writes are "UPDATE 0" with exit status 0, so the script
# reports success over a database it changed nothing in. That is the failure mode this suite pins
# in both halves.
#
# WHAT it proves:
#   1. the shared helper hands `PGOPTIONS` to the CHILD environment and names it on the docker
#      command line without a value — the mechanism every call site relies on;
#   2. every psql/pg_restore/pg_dump call site in the affected scripts carries an identity, the
#      identity is the documented one for that script, and none of them prefixes the setting onto
#      its SQL (no `SET cms.actor` in a statement, no per-statement wrapper);
#   3. the scripts that were measured NOT to need an identity carry none — a defensive flag would
#      make them look covered by a mechanism they never exercise;
#   4. `__contest_set_active.sh` runs end to end through a stub docker and its contract with the
#      database is "every statement carries system:cli";
#   5. on a real database, built from the committed policy SQL, the statements the scripts issue
#      do nothing without the actor and take effect with it — including the COPY that a restore
#      replays, which no actor can make work and only a bypassing role can.
#
# HOW it isolates: half of this suite needs no daemon, no network and no database. The other half
# creates the tables it exercises in `public` of the database you point it at and drops them on
# exit — point it at a scratch database, never at a contest's, exactly like
# tests/test_rls_actor_enforcement.sh.
#
# RUN: CMS_RLS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/cmsdb \
#        bash tests/test_script_db_actor.sh
# Without that variable the live half prints SKIP and its assertions are not counted — CI has no
# database, and a suite that fails for "no server" teaches people to ignore the result.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCRIPTS="${ROOT}/scripts"
MIGRATION="${ROOT}/admin-panel/prisma/migrations/20261025120000_rls_actor_policies/migration.sql"
URL="${CMS_RLS_TEST_DATABASE_URL:-}"
PSQL="${PSQL:-psql}"

pass=0
fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cms-script-actor.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# The constant's own value, read out of the library rather than restated: a suite that retyped the
# string would pin the copy, and the copy is never what the scripts send.
# WHY a subshell: sourcing __lib/common.sh enables `set -euo pipefail`, which this suite must not
# adopt — a failing assertion here is a report, not an exit.
common_value() { # <variable name>
  bash -c 'source "$1/scripts/__lib/common.sh" >/dev/null 2>&1; printf "%s" "${!2:-}"' _ "$ROOT" "$1"
}
MIGRATION_ACTOR="$(common_value DB_ACTOR_SYSTEM_MIGRATION)"
CLI_ACTOR="$(common_value DB_ACTOR_SYSTEM_CLI)"

printf '== the identity the library hands over ==\n'

if [[ "$MIGRATION_ACTOR" == "-c cms.actor=system:migration" && "$CLI_ACTOR" == "-c cms.actor=system:cli" ]]; then
  ok "common.sh defines both script identities the policy allowlist admits"
else
  no "common.sh identities are '${MIGRATION_ACTOR}' / '${CLI_ACTOR}' — expected -c cms.actor=system:{migration,cli}"
fi

# The shape has to be exactly `-c cms.actor=system:<name>`: libpq splits PGOPTIONS on whitespace and
# passes the rest to the server, and public.cms_actor() matches the allowlist by whole string. A typo
# or an extra flag would be indistinguishable from no actor at all.
if [[ "$MIGRATION_ACTOR" =~ ^-c\ cms\.actor=system:(migration|cli|core|scheduler|ingest|auth)$ ]]; then
  ok "the value is a single -c assignment naming a trusted identity (libpq reads it at connect time)"
else
  no "the value does not have the startup-packet shape libpq needs: ${MIGRATION_ACTOR}"
fi

# ── 1. The helper: value in the child environment, name only on the argv ─────────────────────
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
{
  printf 'argv:'
  printf ' %s' "$@"
  printf '\n'
  printf 'actor:%s\n' "${PGOPTIONS:-<unset>}"
} >> "${STUB_LOG:?}"
exit 0
STUB
chmod 755 "$WORK/bin/docker"

# One docker_exec_db call, made the way a script makes it, with the stub standing in for docker.
helper_call() { # <NAME=VALUE ...>
  local log="$WORK/helper.log"
  : > "$log"
  (
    PATH="$WORK/bin:$PATH"
    export STUB_LOG="$log"
    # shellcheck source=/dev/null
    source "${ROOT}/scripts/__lib/common.sh"
    docker_exec_db 'stub-pass' "$@" -i cms-database psql -U cmsuser -d cmsdb -c 'select 1'
  ) >/dev/null 2>&1
  cat "$log"
}

helper_out="$(helper_call "PGOPTIONS=${MIGRATION_ACTOR}")"
if grep -q -- '-e PGOPTIONS' <<<"$helper_out"; then
  ok "docker_exec_db names PGOPTIONS on the docker command line, so docker copies it into the container"
else
  no "docker_exec_db did not name PGOPTIONS on the docker command line: ${helper_out}"
fi
if grep -q 'PGOPTIONS=-c' <<<"$helper_out"; then
  no "the actor's VALUE reached the docker argv (readable in /proc/<pid>/cmdline): ${helper_out}"
else
  ok "the value stays in the client environment; only the name is on the argv"
fi
if grep -qx "actor:${MIGRATION_ACTOR}" <<<"$helper_out"; then
  ok "the child (inside the container) sees cms.actor=system:migration"
else
  no "the child did not receive the identity: $(grep '^actor:' <<<"$helper_out")"
fi

printf '\n== every database call site in the affected scripts ==\n'

# A shell command can span lines; a call site is the whole command, not the line the binary name
# happens to land on. Continuations are folded so a `docker_exec_db ... \` + `psql ...` pair is read
# as one command and cannot hide behind its second line.
logical_lines() { # <file>
  awk '
    { line = $0
      while (line ~ /\\[[:space:]]*$/) {
        sub(/\\[[:space:]]*$/, "", line)
        if ((getline nxt) <= 0) break
        line = line " " nxt
      }
      print line
    }' "$1"
}

# The call sites that talk to the panel database: a command that reaches psql/pg_restore/pg_dump,
# through the shared helper or through docker exec. Comment lines are excluded because the same
# names appear in explanations.
db_calls() { # <file>
  logical_lines "$1" | grep -vE '^[[:space:]]*#' | grep -E 'docker_exec_db|docker exec' \
    | grep -E '(^|[^[:alnum:]_])(psql|pg_restore|pg_dump)([^[:alnum:]_]|$)'
}

# AFFECTED: script:identity. Restore and the provisioning render mutate/read the database outside a
# user request, so they act as the migration identity; contest set-active is one change an operator
# asked for through ./cms, so it acts as the CLI identity.
AFFECTED=(
  "__restore.sh:DB_ACTOR_SYSTEM_MIGRATION"
  "__config_sync.sh:DB_ACTOR_SYSTEM_MIGRATION"
  "__contest_set_active.sh:DB_ACTOR_SYSTEM_CLI"
)

for entry in "${AFFECTED[@]}"; do
  script="${SCRIPTS}/${entry%%:*}"
  want="${entry##*:}"
  calls="$(db_calls "$script")"
  if [[ -z "$calls" ]]; then
    no "${entry%%:*}: no database call site found — this suite would otherwise pass over nothing"
    continue
  fi
  if grep -q 'PGOPTIONS=' <<<"$calls"; then
    every="yes"
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      if [[ "$line" != *PGOPTIONS=* ]]; then every="no"; break; fi
    done <<<"$calls"
    if [[ "$every" == "yes" ]]; then
      ok "${entry%%:*}: every psql/pg_restore call carries an identity"
    else
      no "${entry%%:*}: at least one database call carries no identity: ${line}"
    fi
  else
    no "${entry%%:*}: no database call carries an identity"
  fi

  if grep -q "$want" <<<"$calls"; then
    ok "${entry%%:*}: announces \$${want}"
  else
    no "${entry%%:*}: does not announce \$${want} — it claims some other identity"
  fi

  # No SQL prefix and no per-statement wrapper: `cms.actor` may appear in an explanation or as the
  # value of PGOPTIONS, never inside a statement the script sends.
  prefixed="$(grep -n 'cms\.actor' "$script" | grep -vE ':[[:space:]]*#' | grep -v 'PGOPTIONS=' || true)"
  if [[ -z "$prefixed" ]]; then
    ok "${entry%%:*}: nothing sets the actor in SQL — the identity rides the connection"
  else
    no "${entry%%:*}: the actor is set in SQL: ${prefixed}"
  fi
done

# The dashboard reads two STRICT tables and cannot source the library (it must not inherit its
# strict mode), so it spells the CLI identity itself. That copy is pinned here so it cannot drift.
dash_actor="$(grep -o "PGOPTIONS='[^']*'" "${SCRIPTS}/__tui/__dashboard.sh" | sort -u | tr -d "'" | sed 's/^PGOPTIONS=//')"
if [[ -n "$dash_actor" && "$dash_actor" == "$CLI_ACTOR" ]]; then
  ok "__tui/__dashboard.sh passes the same identity in the child environment (no helper there: no password)"
elif [[ -z "$dash_actor" ]]; then
  no "__tui/__dashboard.sh reads contests/users with no identity — a full contest shows as empty"
else
  no "__tui/__dashboard.sh uses '${dash_actor}', which is not the library's CLI identity ${CLI_ACTOR}"
fi

printf '\n== scripts measured NOT to need an identity carry none ==\n'

# WHY these four, and the evidence that decided it:
#   __apply_sql.sh       applies role/RLS/hardening files — DDL and role statements, which no policy
#                        covers — and verifies them against pg_class. Its one DML path is
#                        --pre-push, which writes cms_legacy and reads admins, whose SELECT is public.
#   __cms-db-init.sh     SELECT 1, information_schema, and scripts/__fix_db_schema.sql, which is DDL.
#   __db_migrate.sh      probes pg_database, to_regclass, _prisma_migrations (exempt from RLS) and
#                        pg_class. Every schema step it runs is `make`, which acts as the core.
#   __db_admin.sh        pg_database, plus single-user mode as the postgres superuser.
#   __db_use.sh          pg_database only.
#   __backup.sh          pg_dump as cms_backup, which is BYPASSRLS precisely so a dump sees all rows;
#                        its one psql is SHOW server_version, which reads no table.
for script in __apply_sql.sh __cms-db-init.sh __db_migrate.sh __db_admin.sh __db_use.sh __backup.sh; do
  if grep -q 'PGOPTIONS' "${SCRIPTS}/${script}"; then
    no "${script}: carries an identity it was measured not to need — justify it or drop it"
  else
    ok "${script}: no identity, and none needed (its statements touch no policy table)"
  fi
done

printf '\n== __contest_set_active.sh, end to end through a stub docker ==\n'

SB="$WORK/sandbox"
mkdir -p "$SB/scripts/__lib" "$SB/bin"
cp "$SCRIPTS/__contest_set_active.sh" "$SB/scripts/"
cp "$ROOT/scripts/__lib/common.sh" "$SB/scripts/__lib/"
printf 'POSTGRES_USER=cmsuser\nPOSTGRES_PASSWORD=stub-password\nPOSTGRES_DB=cmsdb\n' > "$SB/.env"
# The stub answers the four probes the script issues and records, for every statement, which
# identity the child was given and what SQL it was handed.
cat > "$SB/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then printf 'cms-database\n'; exit 0; fi
[[ "${1:-}" == "exec" ]] || exit 0
sql="" prev=""
for a in "$@"; do [[ "$prev" == "-c" ]] && sql="$a"; prev="$a"; done
{ printf 'actor:%s\n' "${PGOPTIONS:-<unset>}"; printf 'sql:%s\n' "$sql"; } >> "${STUB_LOG:?}"
case "$sql" in
  *to_regclass*)                 printf 't\n' ;;
  *"FROM services WHERE role"*)  printf '\n' ;;
  *"WHERE id = 2"*)              printf '1\n' ;;
  *"WHERE is_active"*)           printf '\n' ;;
  *"UPDATE contests"*)           printf 'UPDATE 1\n' ;;
  *)                             printf '\n' ;;
esac
exit 0
STUB
chmod 755 "$SB/bin/docker"

: > "$WORK/contest.log"
( cd "$SB" && PATH="$SB/bin:${PATH}" STUB_LOG="$WORK/contest.log" \
    bash "$SB/scripts/__contest_set_active.sh" 2 ) >"$WORK/contest.out" 2>&1
contest_rc=$?

if [[ "$contest_rc" == "0" ]]; then
  ok "the script runs to completion through the stub"
else
  no "the script exited ${contest_rc}: $(tail -3 "$WORK/contest.out")"
fi

if grep -q '^actor:' "$WORK/contest.log" && ! grep '^actor:' "$WORK/contest.log" | grep -qvx "actor:${CLI_ACTOR}"; then
  ok "every statement it issued carried system:cli"
else
  no "a statement went out with no identity or another one: $(grep '^actor:' "$WORK/contest.log" | sort -u | tr '\n' ' ')"
fi

if grep -q '^sql:' "$WORK/contest.log" && ! grep '^sql:' "$WORK/contest.log" | grep -q 'cms.actor'; then
  ok "no statement carries the actor — nothing is prefixed onto the SQL"
else
  no "an actor setting reached the SQL text: $(grep 'cms.actor' "$WORK/contest.log")"
fi

# ── 5. The same statements on a real database, built from the committed policy SQL ───────────
printf '\n== the write lands only with an identity (live database) ==\n'

if [[ -z "$URL" ]]; then
  printf '  SKIP: set CMS_RLS_TEST_DATABASE_URL to a scratch database to run the live half\n'
elif ! command -v "${PSQL%% *}" >/dev/null 2>&1; then
  printf '  SKIP: %s not on PATH\n' "${PSQL%% *}"
elif [[ ! -f "$MIGRATION" ]]; then
  no "missing policy SQL: ${MIGRATION}"
else
  # -X ignores ~/.psqlrc; ON_ERROR_STOP=0 keeps an expected refusal from ending the session.
  run() { $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c "$1" 2>&1; }
  run_strict() { $PSQL "$URL" -X -tA -v ON_ERROR_STOP=1 -c "$1" 2>&1; }
  # Every probe is issued as cmsuser: the URL may be a scratch server's superuser, and a superuser
  # is not subject to a policy, so an unqualified probe would prove nothing. SET ROLE is in the
  # same session as the statement, which is what the policies see.
  as_cmsuser() { # <sql> [actor]
    if [[ -n "${2:-}" ]]; then
      PGOPTIONS="-c cms.actor=$2" $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cmsuser' -c "$1" 2>&1
    else
      env -u PGOPTIONS "$PSQL" "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cmsuser' -c "$1" 2>&1
    fi
  }
  scalar() { grep -E '^-?[0-9]+$' | tail -1; }

  cleanup_live() {
    run "DROP TABLE IF EXISTS public.contests, public.services, public.contest_exposures, public.submissions, public.users CASCADE;" >/dev/null 2>&1
    run "DROP FUNCTION IF EXISTS public.cms_actor_is_staff_or_auth(); DROP FUNCTION IF EXISTS public.cms_actor_is_staff(); DROP FUNCTION IF EXISTS public.cms_actor_any(text[]); DROP FUNCTION IF EXISTS public.cms_actor_admin_id(); DROP FUNCTION IF EXISTS public.cms_actor();" >/dev/null 2>&1
  }
  trap 'cleanup_live; rm -rf "$WORK"' EXIT

  # The role the policies are written for, and the two attributes this suite turns on.
  run_strict "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cmsuser') THEN CREATE ROLE cmsuser NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB LOGIN; END IF; END \$\$;" >/dev/null
  # The restore's role, defined as admin-panel/prisma/sql/20260820125000_backup_role.sql defines it:
  # BYPASSRLS, and a member of the owner so it inherits the DML a restore needs.
  run_strict "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_backup') THEN CREATE ROLE cms_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB; END IF; END \$\$;" >/dev/null
  run_strict "GRANT cmsuser TO cms_backup;" >/dev/null 2>&1
  attrs="$(run "SELECT rolsuper || '|' || rolbypassrls FROM pg_roles WHERE rolname = 'cmsuser';")"
  if [[ "$attrs" == "false|false" ]]; then
    ok "cmsuser is NOSUPERUSER and NOBYPASSRLS, so the policies apply to it"
  else
    no "cmsuser attributes are ${attrs} — a superuser or BYPASSRLS role would ignore every policy"
  fi

  # The fixture: the real columns the scripts' statements name, owned by cmsuser, FORCE-RLS on.
  cleanup_live
  run_strict "CREATE TABLE public.contests (id int PRIMARY KEY, name varchar, is_active boolean DEFAULT false);" >/dev/null
  run_strict "CREATE TABLE public.services (id serial PRIMARY KEY, name varchar, role varchar, shard int, host varchar, http_port int, rpc_port int, db_profile varchar, image varchar, pull_policy varchar, enabled boolean DEFAULT true, contest_id int);" >/dev/null
  run_strict "CREATE TABLE public.contest_exposures (id serial PRIMARY KEY, hostname varchar, tls boolean, tailnet varchar, contest_id int);" >/dev/null
  run_strict "CREATE TABLE public.submissions (id int PRIMARY KEY, payload varchar);" >/dev/null
  run_strict "CREATE TABLE public.users (id int PRIMARY KEY, username varchar);" >/dev/null
  for t in contests services contest_exposures submissions users; do
    run_strict "ALTER TABLE public.${t} OWNER TO cmsuser; ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;" >/dev/null
  done
  run_strict "INSERT INTO public.contests VALUES (1,'c1',false),(2,'c2',false),(3,'c3',false);" >/dev/null
  run_strict "INSERT INTO public.contest_exposures (hostname, tls, tailnet) VALUES ('a.example', true, 'tn'), ('b.example', false, NULL);" >/dev/null
  run_strict "INSERT INTO public.services (name, role, shard, enabled) VALUES ('web','ContestWebServer',0,true);" >/dev/null
  run_strict "INSERT INTO public.users VALUES (1,'u1');" >/dev/null

  # The committed policy SQL, not a paraphrase: the same extraction tests/test_rls_actor_enforcement.sh
  # uses, so a change to the migration changes what this suite applies.
  HELPERS="$(awk '
    /^CREATE OR REPLACE FUNCTION/ { f = 1 }
    f { print }
    f && /^[[:space:]]*\$\$;$/ { f = 0 }
  ' "$MIGRATION")"
  policy_block() { # <table>
    awk -v want="-- $1" '
      $0 == want { f = 1 }
      f && /^$/ { exit }
      f { print }
    ' "$MIGRATION"
  }
  ALL_SQL="$HELPERS"
  for t in contests services contest_exposures submissions users; do
    block="$(policy_block "$t")"
    [[ -n "$block" ]] || no "no committed policy block for ${t}"
    ALL_SQL="${ALL_SQL}
${block}"
  done
  if printf '%s\n' "$ALL_SQL" | $PSQL "$URL" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
    ok "the committed policy SQL applies to every table these scripts touch"
  else
    printf '%s\n' "$ALL_SQL" | $PSQL "$URL" -X -q -v ON_ERROR_STOP=1 2>&1 | sed 's/^/    /'
    no "the committed policy SQL did not apply — the migration and the generator disagree"
  fi

  # ── contests: the statement __contest_set_active.sh issues ──────────────────────────────────
  got="$(as_cmsuser "UPDATE public.contests SET is_active = true WHERE id = 2;" | tr '\n' ' ')"
  landed="$(run "SELECT count(*) FROM public.contests WHERE is_active;" | scalar)"
  if [[ "$got" == *"UPDATE 0"* && "$landed" == "0" ]]; then
    ok "no actor: the activate UPDATE affects 0 rows and exits 0 — the silent no-op the script used to report as success"
  else
    no "no actor: the UPDATE reported '${got}' and ${landed} row(s) are active — expected UPDATE 0"
  fi

  got="$(as_cmsuser "UPDATE public.contests SET is_active = true WHERE id = 2;" "system:cli" | tr '\n' ' ')"
  landed="$(run "SELECT count(*) FROM public.contests WHERE is_active AND id = 2;" | scalar)"
  if [[ "$got" == *"UPDATE 1"* && "$landed" == "1" ]]; then
    ok "with system:cli: the same UPDATE affects 1 row and the row it names is active"
  else
    no "with system:cli: the UPDATE reported '${got}' and ${landed} row(s) match — expected UPDATE 1"
  fi

  # ── contest_exposures: the read __config_sync.sh renders from ───────────────────────────────
  no_actor_count="$(as_cmsuser "SELECT count(*) FROM public.contest_exposures;" | scalar)"
  with_actor_count="$(as_cmsuser "SELECT count(*) FROM public.contest_exposures;" "system:migration" | scalar)"
  if [[ "$no_actor_count" == "0" && "$with_actor_count" == "2" ]]; then
    ok "config sync: contest_exposures reads 0 rows with no actor and 2 with system:migration"
  else
    no "config sync: exposure counts were '${no_actor_count}' (none) and '${with_actor_count}' (with) — expected 0 and 2"
  fi

  # services SELECT is deliberately public, which is why the registry read never needed the actor
  # and why contest_exposures is the one that did.
  registry="$(as_cmsuser "SELECT count(*) FROM public.services WHERE enabled;" | scalar)"
  if [[ "$registry" == "1" ]]; then
    ok "config sync: services is readable with no actor (public board read), so only the exposure reads needed one"
  else
    no "config sync: services returned '${registry}' with no actor — expected 1 (its SELECT is public)"
  fi

  # ── The restore's COPY: what pg_restore replays, and why the actor cannot save it ──────────
  # A custom-format dump restores its data as COPY. PostgreSQL refuses COPY FROM into a table that
  # has row-level security enabled for the connecting role, policies and actors notwithstanding —
  # so the restore's identity is the login role, not only the GUC.
  copy_no_actor="$(printf '900\tpayload\n\\.\n' | $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cmsuser' -c 'COPY public.submissions (id, payload) FROM stdin' 2>&1)"
  copy_with_actor="$(printf '901\tpayload\n\\.\n' | PGOPTIONS="-c cms.actor=system:migration" $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cmsuser' -c 'COPY public.submissions (id, payload) FROM stdin' 2>&1)"
  if grep -q 'COPY FROM not supported with row-level security' <<<"$copy_no_actor" \
     && grep -q 'COPY FROM not supported with row-level security' <<<"$copy_with_actor"; then
    ok "restore: COPY is refused for cmsuser with AND without the actor — an actor alone cannot restore"
  else
    no "restore: COPY as cmsuser behaved differently than measured (none='${copy_no_actor}' actor='${copy_with_actor}')"
  fi

  backup_attrs="$(run "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'cms_backup';" | tr -d '[:space:]')"
  if [[ "$backup_attrs" == "t" ]]; then
    ok "restore: cms_backup is BYPASSRLS — the role __restore.sh now connects as for a live restore"
  else
    no "restore: cms_backup is not a BYPASSRLS role (rolbypassrls='${backup_attrs}'), so it cannot restore either"
  fi

  copy_backup="$(printf '902\tpayload\n\\.\n' | $PSQL "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cms_backup' -c 'COPY public.submissions (id, payload) FROM stdin' 2>&1)"
  landed="$(run "SELECT count(*) FROM public.submissions;" | scalar)"
  if grep -q '^COPY 1' <<<"$copy_backup" && [[ "$landed" == "1" ]]; then
    ok "restore: the same COPY lands a row through the bypassing role, and the count matches"
  else
    no "restore: COPY through cms_backup reported '${copy_backup}' with ${landed} row(s) present — expected COPY 1"
  fi

  # ── The scripts that were measured not to need an actor: their statements, run as cmsuser ──
  probe="$(as_cmsuser "SELECT 1 FROM information_schema.tables WHERE table_name = 'contests';" | scalar)"
  if [[ "$probe" == "1" ]]; then
    ok "__cms-db-init.sh: its information_schema probe answers with no actor (a catalog, not a policy table)"
  else
    no "__cms-db-init.sh: the information_schema probe returned '${probe}' with no actor — expected 1"
  fi

  ddl="$(as_cmsuser "ALTER TABLE public.contests ADD COLUMN IF NOT EXISTS actor_probe int;" 2>&1)"
  if ! grep -qi 'row-level security' <<<"$ddl"; then
    ok "__apply_sql.sh: DDL runs with no actor (no policy covers a schema change)"
  else
    no "__apply_sql.sh: DDL was refused for want of an actor: ${ddl}"
  fi
  run "ALTER TABLE public.contests DROP COLUMN IF EXISTS actor_probe;" >/dev/null 2>&1

  expected_list="('contests'),('services'),('contest_exposures'),('submissions'),('users')"
  rls_gap="$(as_cmsuser "WITH expected(tbl) AS (VALUES ${expected_list}) SELECT count(*) FROM expected e JOIN pg_class c ON c.relname = e.tbl JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind = 'r' AND NOT c.relrowsecurity;" | scalar)"
  if [[ "$rls_gap" == "0" ]]; then
    ok "__apply_sql.sh: its pg_class RLS assertion returns 0 gaps with no actor (pg_class is not row-secured)"
  else
    no "__apply_sql.sh: the RLS assertion returned '${rls_gap}' with no actor — expected 0"
  fi

  db_probe="$(as_cmsuser "SELECT 1 FROM pg_database WHERE datname = current_database();" | scalar)"
  if [[ "$db_probe" == "1" ]]; then
    ok "__db_migrate.sh / __db_admin.sh / __db_use.sh: pg_database answers with no actor"
  else
    no "the pg_database probe returned '${db_probe}' with no actor — expected 1"
  fi

  # __backup.sh's pg_dump relies on exactly this: a bypassing role sees every row with no actor.
  dump_rows="$(env -u PGOPTIONS "$PSQL" "$URL" -X -tA -v ON_ERROR_STOP=0 -c 'SET ROLE cms_backup' -c 'SELECT count(*) FROM public.contests' 2>&1 | scalar)"
  if [[ "$dump_rows" == "3" ]]; then
    ok "__backup.sh: cms_backup reads every FORCE-RLS row with no actor — the property pg_dump needs"
  else
    no "__backup.sh: cms_backup read '${dump_rows}' rows with no actor — expected 3"
  fi
fi

printf '\n== %d passed, %d failed ==\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
exit 0
