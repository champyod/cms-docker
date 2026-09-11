-- 20260820120000_db_roles.sql — least-privilege DB roles
-- WHY: split the single cmsuser superuser into scoped roles so admin/monitor cannot DROP or corrupt arbitrary tables.
-- WHY: forward-only and idempotent (DO $$ guards, GRANT is idempotent, no DROP) so it is safe to re-run on LIVE and after prisma db push.
-- Requires psql variables: cms_service_password, cms_admin_password, cms_monitor_password (supplied by scripts/__apply_sql.sh, never stored here).
-- WHY set_config: psql :'var' interpolation does not happen inside DO $$ dollar-quoted bodies when the file is fed via -f - (stdin); set_config stores the value so PL/pgSQL can read it via current_setting.

-- cms_service — Python core/services. Full DML, no DDL.
-- WHY: services DO manage large objects via lo_* (src/cms/db/fsobject.py uses LargeObject with lo_creat/lo_open/loread/lowrite/lo_unlink) so SELECT on pg_largeobject is granted for direct reads; writes happen via lo_* ownership path but pg_largeobject SELECT covers inspection.
SELECT set_config('my.cms_service_password', :'cms_service_password', false);
DO $$
DECLARE _pw text := current_setting('my.cms_service_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_service') THEN
    EXECUTE format('CREATE ROLE cms_service WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  ELSE
    EXECUTE format('ALTER ROLE cms_service WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  END IF;
END $$;

-- cms_admin — Admin panel (Next.js). DML on app tables, no DDL.
-- WHY: admin panel DOES use large objects (admin-panel/src/lib/fsobjects.ts uses lo_from_bytea to store uploads into fsobjects) so cms_admin is granted SELECT/INSERT/UPDATE/DELETE on pg_largeobject to allow direct large-object lifecycle via SQL when needed; DML via app tables still governs the fsobjects rows.
SELECT set_config('my.cms_admin_password', :'cms_admin_password', false);
DO $$
DECLARE _pw text := current_setting('my.cms_admin_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin') THEN
    EXECUTE format('CREATE ROLE cms_admin WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  ELSE
    EXECUTE format('ALTER ROLE cms_admin WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  END IF;
END $$;

-- cms_monitor — Monitor service. SELECT only.
SELECT set_config('my.cms_monitor_password', :'cms_monitor_password', false);
DO $$
DECLARE _pw text := current_setting('my.cms_monitor_password');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_monitor') THEN
    EXECUTE format('CREATE ROLE cms_monitor WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  ELSE
    EXECUTE format('ALTER ROLE cms_monitor WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', _pw);
  END IF;
END $$;

-- cms_readonly — Reporting. SELECT only, no login by default.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_readonly') THEN
    CREATE ROLE cms_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- WHY: USAGE on public is required to resolve tables/sequences at all.
GRANT USAGE ON SCHEMA public TO cms_service, cms_admin, cms_monitor, cms_readonly;

-- WHY: revoke CREATE on public from least-privilege roles so even if PUBLIC still has it, these roles cannot DDL (forward-only enforcement).
REVOKE CREATE ON SCHEMA public FROM cms_service, cms_admin, cms_monitor, cms_readonly;

-- DML roles: full DML on all current app tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cms_service, cms_admin;

-- DML roles need sequence USAGE/SELECT for SERIAL/IDENTITY nextval.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cms_service, cms_admin;

-- Read-only roles: SELECT only.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cms_monitor, cms_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cms_monitor, cms_readonly;

-- pg_largeobject: WHY split as verified — services read via large-object functions but benefit from SELECT for inspection; admin needs write path for file uploads; monitor/readonly need read for reporting.
GRANT SELECT ON TABLE pg_catalog.pg_largeobject TO cms_service, cms_monitor, cms_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pg_catalog.pg_largeobject TO cms_admin;

-- WHY: default privileges so future tables created by cmsuser (owner) inherit the least-privilege grants without manual re-run (re-apply script still covers drift).
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cms_service, cms_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cms_service, cms_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT SELECT ON TABLES TO cms_monitor, cms_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT SELECT ON SEQUENCES TO cms_monitor, cms_readonly;
