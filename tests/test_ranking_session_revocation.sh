#!/usr/bin/env bash
# Static guard for the WS-02 revocation path: the table must be reachable by the
# console role, and every source of a permission change must delete its sessions.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
table="$root/admin-panel/prisma/migrations/20261122140000_ranking_session_records/migration.sql"
policy="$root/admin-panel/prisma/migrations/20261122190000_ranking_session_policies/migration.sql"
trigger="$root/admin-panel/prisma/migrations/20261122191000_ranking_session_revocation/migration.sql"
web="$root/ranking-web/src"

fail=0
pass=0
ok() { pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }

grep -q 'CREATE TABLE "ranking_sessions"' "$table" && ok || bad "session table missing"
grep -q 'GRANT SELECT, INSERT, DELETE ON "ranking_sessions" TO cmsuser' "$table" && ok || bad "console role cannot reach the session table"
grep -q 'ranking_sessions FORCE ROW LEVEL SECURITY' "$policy" && ok || bad "session table has no forced RLS"
grep -q 'CREATE POLICY cms_actor_all ON public.ranking_sessions' "$policy" && ok || bad "session table has no policy"
grep -q 'AFTER UPDATE OF authentication, enabled, username ON public.admins' "$trigger" && ok || bad "credential changes do not revoke sessions"
grep -q 'AFTER INSERT OR UPDATE OR DELETE ON public.admin_groups' "$trigger" && ok || bad "group changes do not revoke sessions"
grep -q 'AFTER INSERT OR UPDATE OR DELETE ON public.admin_permission_overrides' "$trigger" && ok || bad "override changes do not revoke sessions"
grep -q 'DELETE FROM public.ranking_sessions WHERE admin_id' "$trigger" && ok || bad "revocation does not delete by admin"
grep -q 'sessions::insert' "$web/login/submit.rs" && ok || bad "login does not record the session"
grep -q 'sessions::is_live' "$web/login/gate.rs" && ok || bad "gate does not check the session"
grep -q 'sessions::delete' "$web/login/logout.rs" && ok || bad "logout does not delete the session"

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
