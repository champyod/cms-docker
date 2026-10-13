-- 20261012010000_drop_backup_locations/migration.sql
-- WHY: the locations layer was retired — the one archive tree is whatever BACKUP_DIR
-- mounts, resolved in code, not a row. Drop the FK and the table; the schedule's
-- locationId stays as a plain, unconstrained column so nothing that still reads it breaks.

ALTER TABLE "backup_schedules" DROP CONSTRAINT IF EXISTS "backup_schedules_locationId_fkey";

DROP TABLE IF EXISTS "backup_locations";
