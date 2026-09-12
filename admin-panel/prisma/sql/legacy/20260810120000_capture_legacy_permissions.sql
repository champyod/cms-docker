-- 20260810120000_capture_legacy_permissions.sql — preserve legacy boolean columns before they are dropped.
-- WHY: prisma db push with the new schema DROPs permission_all, permission_messaging,
-- permission_tasks, permission_users, permission_contests from admins. Without a pre-push
-- snapshot the data is lost and the later backfill (20260815120000) has nothing to read.
-- WHY cms_legacy schema (not public): two defects if placed in public:
--   (a) prisma db push sees an unmanaged table in public and refuses without --accept-data-loss,
--       or drops it with --accept-data-loss causing the backfill to no-op and lose admin mappings.
--       Prisma only manages the schema in the connection search_path (public), so a table
--       outside public is invisible to db push.
--   (b) scripts/__apply_sql.sh asserts every public table has RLS; an unmanaged public table
--       without RLS triggers a false failure. Tables outside public are not inspected.
-- WHY forward-only and idempotent: CREATE SCHEMA/TABLE IF NOT EXISTS so re-run is safe; copy is
-- guarded by information_schema.columns so it is a no-op on a fresh database where the
-- columns never existed; INSERT uses ON CONFLICT DO NOTHING so repeated runs do not
-- duplicate rows. Forward-only upgrade path for already-migrated DBs: if public._legacy_admin_permissions
-- exists from a previous run, copy its rows into cms_legacy and leave the old table alone (never DROP).
-- Retention: cms_legacy._legacy_admin_permissions is kept as the rollback record until a later
-- release removes it deliberately — do not DROP it here.

-- Create the dedicated schema and rollback table if they do not already exist.
-- WHY IF NOT EXISTS: safe to re-run and safe on fresh databases.
-- WHY cms_legacy: keeps the rollback table outside public so Prisma and the RLS assertion ignore it.
CREATE SCHEMA IF NOT EXISTS cms_legacy;

CREATE TABLE IF NOT EXISTS cms_legacy._legacy_admin_permissions (
  id                   integer PRIMARY KEY,
  permission_all       boolean,
  permission_messaging boolean,
  permission_tasks     boolean,
  permission_users     boolean,
  permission_contests  boolean
);

-- Copy only when the legacy boolean columns still exist on admins.
-- WHY information_schema guard: on a fresh database the columns were never created
-- so the SELECT would fail; the guard makes the whole operation a no-op.
-- WHY EXECUTE: avoids parse-time failure when columns are absent; the dynamic
-- string is only prepared when the guard passes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'permission_all'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'permission_messaging'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'permission_tasks'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'permission_users'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'permission_contests'
  ) THEN
    -- WHY ON CONFLICT DO NOTHING: idempotent — re-running does not duplicate rows.
    EXECUTE '
      INSERT INTO cms_legacy._legacy_admin_permissions (id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests)
      SELECT id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests
      FROM public.admins
      ON CONFLICT (id) DO NOTHING
    ';
  END IF;
END $$;

-- Forward-only migration for already-migrated databases: copy from the old public location if it exists.
-- WHY: an earlier version of this migration created public._legacy_admin_permissions. Moving to
-- cms_legacy must preserve those rows without dropping the old table (forward-only).
-- WHY the guard checks COLUMNS and not only the table: a table of that name can exist without the
-- legacy boolean columns (an interrupted or hand-made earlier attempt). Checking existence alone
-- would pass the guard and then fail at runtime on the missing column, aborting the whole apply.
-- WHY IF EXISTS guard + ON CONFLICT DO NOTHING: safe on fresh DBs (old table absent) and idempotent on re-run.
DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '_legacy_admin_permissions'
      AND column_name IN ('id', 'permission_all', 'permission_messaging',
                          'permission_tasks', 'permission_users', 'permission_contests')
  ) = 6 THEN
    EXECUTE '
      INSERT INTO cms_legacy._legacy_admin_permissions (id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests)
      SELECT id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests
      FROM public._legacy_admin_permissions
      ON CONFLICT (id) DO NOTHING
    ';
  END IF;
END $$;
