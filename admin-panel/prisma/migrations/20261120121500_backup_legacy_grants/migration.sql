-- 20261120121500_backup_legacy_grants/migration.sql — WS-76
--
-- WHY this grant exists: the backup role used to be a member of cmsuser, and that membership was the
-- only thing that let pg_dump read anything outside `public`. pg_dump walks every non-system schema,
-- so on a database that went through the RBAC cutover it also reads cms_legacy._legacy_admin_permissions
-- (the retained permission rollback record, 20260912000100_capture_legacy_permissions). Revoking the
-- membership without replacing that read makes the next dump fail — measured on a scratch PG15, not
-- assumed:
--
--   pg_dump: error: query failed: ERROR:  permission denied for table _legacy_admin_permissions
--   pg_dump: detail: Query was: LOCK TABLE cms_legacy._legacy_admin_permissions IN ACCESS SHARE MODE
--
-- WHAT makes it unnecessary to widen anything else: 20260912000150_backup_grants already covers every
-- table and sequence in `public` and the two pg_catalog large-object relations, and BYPASSRLS makes
-- FORCE RLS transparent to a reader. cms_legacy is the only other schema this database creates.
--
-- WHY conditional on the schema: a fresh database runs 20260912000100 before this file, so the schema
-- is there; the guard keeps a database that never had the capture table from aborting the deploy.
-- cmsuser owns that table (migrations run as cmsuser), so the owner can grant on it. The role check
-- mirrors 20260912000150_backup_grants: a missing role means the bootstrap step was skipped, and a
-- silent dump failure later is worse than a loud deploy failure now.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cms_legacy') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_backup') THEN
      RAISE EXCEPTION 'role cms_backup is missing — run the role bootstrap step before migrate deploy';
    END IF;
    EXECUTE 'GRANT USAGE ON SCHEMA cms_legacy TO cms_backup';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA cms_legacy TO cms_backup';
  END IF;
END $$;
