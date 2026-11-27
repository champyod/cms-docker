-- A stored value outside the two modes must never open the public board.
UPDATE "ranking_settings"
SET "access_mode" = 'protected'
WHERE "access_mode" NOT IN ('public', 'protected');

ALTER TABLE "ranking_settings"
DROP CONSTRAINT IF EXISTS "ranking_settings_access_mode_check";

ALTER TABLE "ranking_settings"
ADD CONSTRAINT "ranking_settings_access_mode_check"
CHECK ("access_mode" IN ('public', 'protected'));
