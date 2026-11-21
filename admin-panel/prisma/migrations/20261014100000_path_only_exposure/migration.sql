-- 20261014100000_path_only_exposure/migration.sql
-- A path-only exposure: hostname becomes nullable, and a location is unique per contest
-- rather than globally, so two contests may answer at the same path of their own vhost
-- while one contest cannot hold two rows for one location.
-- WHY guarded: a rebuilt database re-applies migrations and prod may already carry a
-- manual patch, so each statement is safe to run on either.

DO $$ BEGIN
  IF to_regclass('public.contest_exposures') IS NOT NULL THEN
    ALTER TABLE "contest_exposures" ALTER COLUMN "hostname" DROP NOT NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS "contest_exposures_hostname_path_key";
CREATE UNIQUE INDEX IF NOT EXISTS "contest_exposures_contest_id_hostname_path_key" ON "contest_exposures"("contest_id", "hostname", "path");
