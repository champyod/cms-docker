-- 20260912000150_backup_grants/migration.sql — database-scoped grants for cms_backup
-- WHY: PostgreSQL roles are cluster-scoped; _prisma_migrations is per-database. Role creation
-- and membership live in the privileged bootstrap (scripts/__apply_sql.sh --bootstrap-roles);
-- this migration carries only database-scoped GRANTs.

-- Fail loudly if the role does not exist — operator must run the bootstrap step first.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cms_backup') THEN RAISE EXCEPTION 'role cms_backup is missing — run the role bootstrap step before migrate deploy'; END IF; END $$;

-- WHY USAGE on public is required to resolve tables/sequences at all.
GRANT USAGE ON SCHEMA public TO cms_backup;

-- WHY SELECT on all current app tables/sequences: pg_dump must read every table and sequence state.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cms_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cms_backup;

-- WHY pg_largeobject: pg_dump reads large objects via pg_largeobject; without SELECT the dump misses file payloads.
GRANT SELECT ON TABLE pg_catalog.pg_largeobject TO cms_backup;

-- WHY pg_largeobject_metadata: pg_dump also reads metadata (9.3+) to enumerate large objects; grant if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pg_largeobject_metadata' AND relnamespace = 'pg_catalog'::regnamespace) THEN
    EXECUTE 'GRANT SELECT ON TABLE pg_catalog.pg_largeobject_metadata TO cms_backup';
  END IF;
END $$;

-- WHY default privileges so future tables/sequences created by cmsuser inherit SELECT for backup without re-run (re-apply still covers drift).
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT SELECT ON TABLES TO cms_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE cmsuser IN SCHEMA public GRANT SELECT ON SEQUENCES TO cms_backup;
