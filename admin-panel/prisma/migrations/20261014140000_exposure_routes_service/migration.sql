-- 20261014140000_exposure_routes_service/migration.sql
-- An exposure now routes to a SERVICE row instead of naming a contest: the row decides what
-- runs, so one statement decides both what is served and where it is reachable, and a service
-- no contest owns — the admin panel, the ranking board — can be exposed too.
--
-- WHY the backfill is hand-written: it is the one part of this change the generator cannot
-- express. It resolves each existing exposure the way the renderer did — the enabled
-- ContestWebServer bound to that contest first, else the shared one, lowest shard — and FAILS
-- when a row names a contest no server serves, rather than dropping the row or guessing a
-- service. Bind a server to that contest in the service registry, then re-run this migration.
--
-- WHY guarded: a rebuilt database re-applies migrations and prod may already carry the column,
-- so each statement is safe to run on either.

ALTER TABLE "contest_exposures" ADD COLUMN IF NOT EXISTS "service_id" INTEGER;

DO $$
DECLARE
  shared_id INTEGER;
  unserved INTEGER;
BEGIN
  UPDATE "contest_exposures" AS e
  SET "service_id" = bound."id"
  FROM (
    SELECT DISTINCT ON (s."contest_id") s."contest_id", s."id"
    FROM "services" AS s
    WHERE s."role" = 'ContestWebServer' AND s."enabled" AND s."contest_id" IS NOT NULL
    ORDER BY s."contest_id", s."shard", s."id"
  ) AS bound
  WHERE e."service_id" IS NULL AND e."contest_id" = bound."contest_id";

  SELECT s."id" INTO shared_id
  FROM "services" AS s
  WHERE s."role" = 'ContestWebServer' AND s."enabled" AND s."contest_id" IS NULL
  ORDER BY s."shard", s."id" LIMIT 1;

  IF shared_id IS NOT NULL THEN
    UPDATE "contest_exposures" SET "service_id" = shared_id WHERE "service_id" IS NULL;
  END IF;

  SELECT count(*) INTO unserved FROM "contest_exposures" WHERE "service_id" IS NULL;
  IF unserved > 0 THEN
    RAISE EXCEPTION 'contest_exposures holds % exposure(s) naming a contest no enabled ContestWebServer serves — bind a server to that contest in the service registry, then re-run', unserved;
  END IF;
END $$;

ALTER TABLE "contest_exposures" ALTER COLUMN "service_id" SET NOT NULL;

DROP INDEX IF EXISTS "contest_exposures_contest_id_hostname_path_key";
DROP INDEX IF EXISTS "ix_contest_exposures_contest_id";
ALTER TABLE "contest_exposures" DROP CONSTRAINT IF EXISTS "contest_exposures_contest_id_fkey";
ALTER TABLE "contest_exposures" DROP COLUMN IF EXISTS "contest_id";

CREATE UNIQUE INDEX IF NOT EXISTS "contest_exposures_service_id_hostname_path_key" ON "contest_exposures"("service_id", "hostname", "path");
CREATE INDEX IF NOT EXISTS "ix_contest_exposures_service_id" ON "contest_exposures"("service_id");

ALTER TABLE "contest_exposures" ADD CONSTRAINT "contest_exposures_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
