-- 20260820120000_db_roles.sql — locked two-role layout: cmsuser (owner/app) + cms_backup (BYPASSRLS, member of owner)
-- WHY: the app (Python services + Next.js admin panel) both connect as cmsuser (owner). Splitting into cms_service/cms_admin
--      broke large-object access because PostgreSQL requires the LO owning role to read it; files uploaded via the panel
--      were unreadable by the grader. Single owner fixes that; no separate DML roles are needed.
-- WHY: only TWO roles exist: cmsuser (owner, demoted in 20260820140000_owner_hardening.sql to NOSUPERUSER NOBYPASSRLS
--      NOCREATEROLE NOCREATEDB, still owns objects so retains DDL) and cms_backup (LOGIN NOSUPERUSER BYPASSRLS
--      NOCREATEDB NOCREATEROLE + MEMBER OF cmsuser for LO reads). Do not reintroduce cms_service/cms_admin/cms_monitor/cms_readonly.
-- WHY: forward-only and idempotent (DO $$ guards, GRANT is idempotent, no DROP) so it is safe to re-run on LIVE and after prisma db push.
-- WHY: role creation/alteration is wrapped in an insufficient_privilege handler because 20260820140000_owner_hardening.sql
--      demotes cmsuser to NOCREATEROLE. Without the handler every subsequent `make prisma-sync` aborts here and the
--      membership below would never re-apply. On re-run the role already exists, so skipping is correct.
-- Requires psql variable: cms_backup_password (supplied by scripts/__apply_sql.sh, never stored here).
-- WHY set_config: psql :'var' interpolation does not happen inside DO $$ dollar-quoted bodies when the file is fed via -f - (stdin); set_config stores the value so PL/pgSQL can read it via current_setting.

-- cms_backup — backup only. BYPASSRLS for pg_dump under FORCE RLS, SELECT via membership/GRANTs, no DDL.
-- WHY BYPASSRLS: pg_dump issues SELECTs over every app table; after 20260820130000_rls.sql enables FORCE RLS and owner is
--      demoted to NOBYPASSRLS, the owner is bound by RLS and pg_dump as cmsuser fails with "query would be affected by
--      row-level security policy". BYPASSRLS lets the dump see all rows.
-- WHY MEMBER OF cmsuser: large-object reads require the owning role; cmsuser creates every LO, so making cms_backup
--      a member of cmsuser inherits LO read for existing AND future objects without per-OID grants. Per-OID grants rot
--      because new LOs never receive them and ALTER DEFAULT PRIVILEGES ... ON LARGE OBJECTS does not exist in PG15.
-- WHY no GRANT SELECT ON TABLE pg_catalog.pg_largeobject here: backup's table access is granted in
--      20260820125000_backup_role.sql; this file only ensures the role exists and the membership is present. No monitor
--      role exists to receive an adversarial pg_largeobject grant.
SELECT set_config('my.cms_backup_password', :'cms_backup_password', false);
DO $$
DECLARE _pw text := current_setting('my.cms_backup_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_backup') THEN
    BEGIN
      EXECUTE format('CREATE ROLE cms_backup WITH LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', _pw);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cms_backup creation requires superuser — skipped on demoted re-apply (role should already exist)';
    END;
  ELSE
    BEGIN
      EXECUTE format('ALTER ROLE cms_backup WITH LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', _pw);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cms_backup password rotation requires superuser — skipped on demoted re-apply';
    END;
  END IF;
END $$;

-- WHY membership: inherits large-object read for existing and future LOs owned by cmsuser; per-OID GRANTs rot.
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT cmsuser TO cms_backup';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'GRANT cmsuser TO cms_backup requires superuser/owner — skipped on demoted re-apply (membership already present)';
  END;
END $$;
