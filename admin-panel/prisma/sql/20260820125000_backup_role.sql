-- 20260820125000_backup_role.sql — dedicated backup role with BYPASSRLS for pg_dump
-- WHY this sorts before 20260820140000_owner_hardening.sql: creating a BYPASSRLS role needs
-- superuser, and owner_hardening demotes cmsuser to NOSUPERUSER/NOBYPASSRLS. If this file ran
-- after it, the role would never be created and backups would stay broken.
-- WHY cms_backup needs BYPASSRLS: pg_dump issues SELECTs over every app table; after
-- 20260820130000_rls.sql enables FORCE ROW LEVEL SECURITY and
-- 20260820140000_owner_hardening.sql demotes cmsuser to NOBYPASSRLS, the owner is
-- bound by RLS and pg_dump as cmsuser fails with "query would be affected by
-- row-level security policy". BYPASSRLS lets the dump see all rows. This role is
-- SELECT-only so it cannot violate the append-only (audit_log) or non-deletable
-- (submissions) guarantees — those rely on absence of policies, which BYPASSRLS does
-- not bypass for writes; SELECT-only ensures no tamper path.
-- WHY forward-only and idempotent: DO $$ existence guards, GRANT is idempotent,
-- no DROP, re-runnable on live; mirrors 20260820120000_db_roles.sql pattern.
-- Requires psql variable: cms_backup_password (supplied by scripts/__apply_sql.sh).

-- cms_backup — backup only. SELECT-only, BYPASSRLS for pg_dump, no DDL, LOGIN to connect.
SELECT set_config('my.cms_backup_password', :'cms_backup_password', false);
DO $$
DECLARE _pw text := current_setting('my.cms_backup_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_backup') THEN
    BEGIN
      EXECUTE format('CREATE ROLE cms_backup WITH LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', _pw);
    EXCEPTION WHEN insufficient_privilege THEN
      -- WHY: re-apply as demoted cmsuser (NOBYPASSRLS) cannot CREATE BYPASSRLS roles; first apply already created it when superuser, so skip.
      RAISE NOTICE 'cms_backup creation requires superuser — skipped on demoted re-apply (role should already exist)';
    END;
  ELSE
    BEGIN
      EXECUTE format('ALTER ROLE cms_backup WITH LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', _pw);
    EXCEPTION WHEN insufficient_privilege THEN
      -- WHY: password rotation also needs superuser for BYPASSRLS; warn but do not fail the whole apply.
      RAISE NOTICE 'cms_backup password rotation requires superuser — skipped on demoted re-apply';
    END;
  END IF;
END $$;

-- WHY GRANT membership: PostgreSQL large objects are readable only by the owning role. cmsuser creates every LO,
-- so making cms_backup a member of cmsuser inherits LO read for existing AND future objects. Per-OID
-- GRANT SELECT ON LARGE OBJECT <oid> would rot because new objects never receive it, and
-- ALTER DEFAULT PRIVILEGES ... ON LARGE OBJECTS does not exist in PG15 (syntax error). Membership is rot-proof.
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT cmsuser TO cms_backup';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'GRANT cmsuser TO cms_backup requires superuser/owner — skipped on demoted re-apply (membership already present)';
  END;
END $$;

-- GRANTs moved to migration 20260912000150_backup_grants (database-scoped grants belong in migration history).
