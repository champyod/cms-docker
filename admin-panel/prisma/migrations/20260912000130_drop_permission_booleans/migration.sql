-- Drop legacy permission_* boolean columns from admins (data preserved via _legacy_admin_permissions and admin_groups backfill).
-- WHY forward-only and idempotent: IF EXISTS makes every DROP safe to run on a fresh
-- database (columns already absent), on an upgraded database (columns present once, then
-- gone after first run), and on repeated re-applies; the DO guard makes it a no-op when
-- the admins table itself is absent (e.g. before first prisma db push). No other
-- destructive DDL; never drops _legacy_admin_permissions — it is retained as the
-- rollback record. Safe to re-run in any order relative to its own re-runs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
    RAISE NOTICE 'drop skip: admins table does not exist';
    RETURN;
  END IF;
  -- WHY IF EXISTS per column: fresh databases already lack these columns; the drop
  -- must not error. EXECUTE is used so the statement is parsed only when the table
  -- is known to exist (avoids hard parse error on absent table edge case).
  EXECUTE 'ALTER TABLE "admins" DROP COLUMN IF EXISTS "permission_all"';
  EXECUTE 'ALTER TABLE "admins" DROP COLUMN IF EXISTS "permission_messaging"';
  EXECUTE 'ALTER TABLE "admins" DROP COLUMN IF EXISTS "permission_tasks"';
  EXECUTE 'ALTER TABLE "admins" DROP COLUMN IF EXISTS "permission_users"';
  EXECUTE 'ALTER TABLE "admins" DROP COLUMN IF EXISTS "permission_contests"';
END $$;
