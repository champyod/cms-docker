-- cmsInitDB compatibility patches for admin-panel and core schema drift
-- WHY: cmsInitDB (Python) creates the core CMS tables but predates several
-- admin-panel and performance columns; this script runs via `make cms-init`
-- (scripts/__cms-db-init.sh) to ensure those columns exist on fresh or
-- long-running databases. It is idempotent (ADD COLUMN IF NOT EXISTS) and
-- safe to re-run.

-- REMOVED: permission_* booleans (permission_tasks, permission_users, permission_contests)
-- previously re-added here have been deliberately dropped by
-- admin-panel/prisma/sql/20260816120000_drop_permission_booleans.sql.
-- WHY removed: `make cms-init` runs immediately before `make prisma-sync` in the
-- upgrade path, so unconditional ADD COLUMN would undo the drop on every upgrade
-- and leave the legacy columns present after the migration intended to remove them.
-- Data was preserved pre-drop in cms_legacy._legacy_admin_permissions (20260810120000)
-- and backfilled to admin_groups (20260815120000). On a fresh database the columns
-- never existed and must not be created; on an upgraded database they were dropped
-- and must stay dropped. Guarding by groups/capture table existence would still
-- reintroduce them on fresh DBs where neither exists yet but where the new schema
-- is canonical. Hence they are no longer added here. If a genuinely pre-migration
-- database needs them, cmsInitDB / the old schema already has them.
-- See: admin-panel/prisma/sql/20260810120000_capture_legacy_permissions.sql

-- Add missing admin annotation column used by EvaluationService
-- WHY patch-owned intentionally: declared by the CMS ORM (src/cms/db/submission.py:770) and absent from admin-panel/prisma/schema.prisma; this script runs on every `make cms-init` for both fresh and existing databases.
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS admin_text VARCHAR;

-- Add contest-level queue fairness penalty (seconds)
ALTER TABLE contests ADD COLUMN IF NOT EXISTS queue_fairness_penalty_seconds INTEGER NOT NULL DEFAULT 0;

-- Add contest-level evaluation throttle policy (throttle family)
ALTER TABLE contests ADD COLUMN IF NOT EXISTS evaluation_throttle_delay_s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS evaluation_throttle_window_s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS evaluation_throttle_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS evaluation_final_open BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS evaluation_final_open_at TIMESTAMP;

-- Add task-level evaluation throttle delay override (seconds, NULL means inherit)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS evaluation_throttle_delay_s INTEGER;
