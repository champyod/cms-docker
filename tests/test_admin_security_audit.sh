#!/usr/bin/env bash
# tests/test_admin_security_audit.sh — the admin security trigger is present and scoped.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="${REPO_ROOT}/admin-panel/prisma/migrations/20261122120000_admin_security_audit/migration.sql"
GENERATOR="${REPO_ROOT}/scripts/__generate_rls_sql.sh"
pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
has() { if grep -qF -- "$2" "$1"; then ok "$3"; else no "$3"; fi; }

has "$MIGRATION" 'CREATE TRIGGER cms_admin_security_audit' 'the admins trigger exists'
has "$MIGRATION" 'AFTER INSERT OR UPDATE OR DELETE ON public.admins' 'the trigger covers insert, update and delete'
has "$MIGRATION" "IF OLD.authentication IS DISTINCT FROM NEW.authentication" 'authentication changes are detected'
has "$MIGRATION" "IF OLD.enabled IS DISTINCT FROM NEW.enabled" 'enabled changes are detected'
has "$MIGRATION" "IF OLD.username IS DISTINCT FROM NEW.username" 'username changes are detected'
has "$MIGRATION" "IF OLD.name IS DISTINCT FROM NEW.name" 'name changes are detected'
has "$MIGRATION" 'left(OLD.authentication, 12)' 'only the old hash prefix is recorded'
has "$MIGRATION" 'left(NEW.authentication, 12)' 'only the new hash prefix is recorded'
has "$MIGRATION" 'session_user' 'the connecting role is recorded'
has "$MIGRATION" 'system:admin-audit' 'the trigger uses its own system identity'
has "$GENERATOR" 'AUDIT_SECURITY' 'the policy generator declares the identity'
trigger_body="$(sed -n '/CREATE OR REPLACE FUNCTION public.cms_admin_security_audit/,/^DROP TRIGGER/p' "$MIGRATION")"
if printf '%s\n' "$trigger_body" | grep -q 'last_login_at'; then
  no "last_login_at is excluded from the trigger"
else
  ok "last_login_at is excluded from the trigger"
fi

printf '\nadmin-security-audit: %d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
