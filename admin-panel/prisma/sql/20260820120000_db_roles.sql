-- 20260820120000_db_roles.sql — locked two-role layout: cmsuser (owner/app) + cms_backup (BYPASSRLS, no membership)
-- WHY: the app (Python services + Next.js admin panel) both connect as cmsuser (owner). Splitting into cms_service/cms_admin
--      broke large-object access because PostgreSQL requires the LO owning role to read it; files uploaded via the panel
--      were unreadable by the grader. Single owner fixes that; no separate DML roles are needed.
-- WHY: only TWO roles exist: cmsuser (owner, demoted in 20260820140000_owner_hardening.sql to NOSUPERUSER NOBYPASSRLS
--      NOCREATEROLE NOCREATEDB, still owns objects so retains DDL) and cms_backup (LOGIN NOSUPERUSER BYPASSRLS
--      NOCREATEDB NOCREATEROLE, SELECT-only, NOT a member of cmsuser since WS-76). Do not reintroduce
--      cms_service/cms_admin/cms_monitor/cms_readonly.
-- WHY: forward-only and idempotent (DO $$ guards, a REVOKE of an absent membership is a no-op, no DROP) so it is safe to re-run on LIVE and after prisma db push.
-- WHY: role creation/alteration is wrapped in an insufficient_privilege handler because 20260820140000_owner_hardening.sql
--      demotes cmsuser to NOCREATEROLE. Without the handler every subsequent `make prisma-sync` aborts here. On
--      re-run the role already exists, so skipping is correct.
-- Requires psql variable: cms_backup_password (supplied by scripts/__apply_sql.sh, never stored here).
-- WHY set_config: psql :'var' interpolation does not happen inside DO $$ dollar-quoted bodies when the file is fed via -f - (stdin); set_config stores the value so PL/pgSQL can read it via current_setting.

-- cms_backup — backup only. BYPASSRLS for pg_dump, SELECT-only, no DDL, LOGIN to connect.
-- WHY BYPASSRLS: pg_dump issues SELECTs over every app table; after 20260820130000_rls.sql enables FORCE RLS and owner is
--      demoted to NOBYPASSRLS, the owner is bound by RLS and pg_dump as cmsuser fails with "query would be affected by
--      row-level security policy". BYPASSRLS lets the dump see all rows.
-- WHY NO membership in cmsuser (WS-76): `GRANT cmsuser TO cms_backup` made the backup role owner-equivalent — a role
--      member inherits the owner's privileges, and PostgreSQL's ownership checks accept a member of the owning role, so
--      cms_backup could UPDATE tables and run DDL on everything cmsuser owns. Dumps need none of that: SELECT on
--      tables/sequences and on pg_largeobject / pg_largeobject_metadata (20260912000150_backup_grants) plus cms_legacy
--      (20261120121500_backup_legacy_grants) is every read pg_dump performs, and BYPASSRLS (above) is what makes FORCE
--      RLS transparent to it. Do not reintroduce the grant; the REVOKE below removes it from a database that still carries it.
-- WHY no GRANT SELECT ON TABLE pg_catalog.pg_largeobject here: backup's table access is granted in
--      20260820125000_backup_role.sql; this file ensures the role exists, keeps its attributes, and revokes the old
--      owner membership. No monitor role exists to receive an adversarial pg_largeobject grant.
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

-- WHY the revoke (WS-76): this file used to run `GRANT cmsuser TO cms_backup`, which made the backup role
--      owner-equivalent — a role member inherits the owner's privileges and PostgreSQL's ownership checks
--      accept a member of the owning role, so cms_backup could UPDATE every table and run DDL on everything
--      cmsuser owns. Dumps need none of it: SELECT on tables/sequences and on pg_largeobject /
--      pg_largeobject_metadata (20260912000150_backup_grants, 20261120121500_backup_legacy_grants) covers
--      every read the dump performs, and BYPASSRLS is what makes FORCE RLS transparent. Never grant it again.
-- WHY the handler and the NOTICE: REVOKE needs superuser or ADMIN OPTION on cmsuser. A fresh install runs
--      this file while cmsuser is still the container superuser, so the revoke happens. A database installed
--      before WS-76 runs it after 20260912000500_owner_hardening demoted cmsuser to NOCREATEROLE, where
--      REVOKE raises 42501 — swallowing that here is safe only because scripts/__apply_sql.sh
--      --bootstrap-roles reads pg_auth_members after the apply and fails loudly when the membership survived.
--      The NOTICE names the one-time superuser route; it is never allowed to look like success.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members am
      JOIN pg_roles granted ON granted.oid = am.roleid
      JOIN pg_roles member  ON member.oid  = am.member
     WHERE granted.rolname = 'cmsuser'
       AND member.rolname  = 'cms_backup'
  ) THEN
    BEGIN
      EXECUTE 'REVOKE cmsuser FROM cms_backup';
      RAISE NOTICE 'WS-76: revoked cmsuser FROM cms_backup — the backup role is SELECT-only';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'WS-76: cms_backup is still a member of cmsuser and % cannot revoke it; run the one-time revoke as a superuser, then re-run the bootstrap', current_user;
    END;
  END IF;
END $$;
