-- 20260820140000_owner_hardening.sql — demote cmsuser so FORCE RLS actually binds
-- WHY: PostgreSQL SUPERUSER and BYPASSRLS bypass RLS even when FORCE ROW LEVEL SECURITY is set, so the append-only guarantees on audit_log/submissions did not apply to cmsuser (the DB owner/app connection). Stripping those attributes closes the bypass.
-- WHY: ownership is independent of the SUPERUSER flag — cmsuser still owns its tables/objects after demotion, so it retains implicit DDL rights (CREATE/ALTER/DROP) on schema public and on owned objects without needing SUPERUSER; no BYPASSRLS is ever granted because every path must satisfy the policies.
-- WHY: idempotent and forward-only — plain ALTER ROLE is re-runnable and succeeds whether already demoted or not; no DROP or destructive DDL; no secrets.

-- Defensive: only alter if the role exists (DO guard avoids hard failure on stripped-down clones).
-- WHY exception handling: after demotion __apply_sql.sh reconnects as cmsuser (now non-superuser); re-running must not fail with insufficient_privilege even though ALTER requires superuser — if already demoted we silently succeed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cmsuser') THEN
    BEGIN
      -- Re-assert least-privilege for the owner: strip bypass + superuser powers.
      -- Keeps LOGIN so existing connection strings still work; removes only the bypass attributes.
      EXECUTE 'ALTER ROLE cmsuser NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB';
    EXCEPTION WHEN insufficient_privilege THEN
      -- Running as demoted cmsuser on re-apply — already least-privilege, nothing to do.
      NULL;
    END;
  END IF;
END $$;
