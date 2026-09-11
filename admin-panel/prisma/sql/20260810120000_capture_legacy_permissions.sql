-- 20260810120000_capture_legacy_permissions.sql — preserve legacy boolean columns before they are dropped.
-- WHY: prisma db push with the new schema DROPs permission_all, permission_messaging,
-- permission_tasks, permission_users, permission_contests from admins. Without a pre-push
-- snapshot the data is lost and the later backfill (20260815120000) has nothing to read.
-- WHY forward-only and idempotent: CREATE TABLE IF NOT EXISTS so re-run is safe; copy is
-- guarded by information_schema.columns so it is a no-op on a fresh database where the
-- columns never existed; INSERT uses ON CONFLICT DO NOTHING so repeated runs do not
-- duplicate rows. Never drops or alters existing data.
-- Retention: _legacy_admin_permissions is kept as the rollback record until a later
-- release removes it deliberately — do not DROP it here.

-- Create the rollback table if it does not already exist.
-- WHY IF NOT EXISTS: safe to re-run and safe on fresh databases.
CREATE TABLE IF NOT EXISTS _legacy_admin_permissions (
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
      INSERT INTO _legacy_admin_permissions (id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests)
      SELECT id, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests
      FROM admins
      ON CONFLICT (id) DO NOTHING
    ';
  END IF;
END $$;
