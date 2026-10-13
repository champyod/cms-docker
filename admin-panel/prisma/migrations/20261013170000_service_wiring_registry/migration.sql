-- 20261013170000_service_wiring_registry/migration.sql
-- WHY: one deployment has to serve several contests. Today docker-compose.yml pins one
-- evaluation-service and one contest-web-server to a single CONTEST_ID, and the only store
-- of "which contest is served" is contests.is_active -- a singleton, so a second contest
-- means a second host. This migration makes the binding data instead of topology:
--   services           every instance, its role, shard, endpoint and DB profile
--   wirings            which instance fronts or drains which other instance
--   contest_exposures  where each contest answers (hostname + path + optional tailnet name)
-- config.toml keeps only the DB pointer and secrets, so a database dump leaks no tailnet key.
-- WHY guarded everywhere: these tables may already exist on prod from a manual patch, and
-- Prisma re-applies migrations on a rebuilt database, so a fresh install and a re-apply must
-- both be safe. to_regclass checks the table OID; pg_constraint checks a constraint by name.

DO $$ BEGIN
  IF to_regclass('public.services') IS NULL THEN
    CREATE TABLE "services" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR NOT NULL,
        "role" VARCHAR NOT NULL,
        "shard" INTEGER NOT NULL DEFAULT 0,
        "host" VARCHAR NOT NULL,
        "port" INTEGER NOT NULL,
        "db_profile" VARCHAR NOT NULL DEFAULT 'default',
        "contest_id" INTEGER,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "services_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.wirings') IS NULL THEN
    CREATE TABLE "wirings" (
        "id" SERIAL NOT NULL,
        "from_service_id" INTEGER NOT NULL,
        "to_service_id" INTEGER NOT NULL,
        "relation" VARCHAR NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "wirings_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.contest_exposures') IS NULL THEN
    CREATE TABLE "contest_exposures" (
        "id" SERIAL NOT NULL,
        "contest_id" INTEGER NOT NULL,
        "hostname" VARCHAR NOT NULL,
        "path" VARCHAR NOT NULL DEFAULT '/',
        "tls" BOOLEAN NOT NULL DEFAULT true,
        "tailnet" VARCHAR,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "contest_exposures_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- One service name identifies one instance; one hostname+path can front only one contest.
CREATE UNIQUE INDEX IF NOT EXISTS "services_name_key" ON "services"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "wirings_from_service_id_to_service_id_relation_key" ON "wirings"("from_service_id", "to_service_id", "relation");
CREATE UNIQUE INDEX IF NOT EXISTS "contest_exposures_hostname_path_key" ON "contest_exposures"("hostname", "path");

CREATE INDEX IF NOT EXISTS "ix_services_role" ON "services"("role");
CREATE INDEX IF NOT EXISTS "ix_services_contest_id" ON "services"("contest_id");
CREATE INDEX IF NOT EXISTS "ix_services_role_shard" ON "services"("role", "shard");
CREATE INDEX IF NOT EXISTS "ix_wirings_from_service_id" ON "wirings"("from_service_id");
CREATE INDEX IF NOT EXISTS "ix_wirings_to_service_id" ON "wirings"("to_service_id");
CREATE INDEX IF NOT EXISTS "ix_contest_exposures_contest_id" ON "contest_exposures"("contest_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_contest_id_fkey') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wirings_from_service_id_fkey') THEN
    ALTER TABLE "wirings" ADD CONSTRAINT "wirings_from_service_id_fkey" FOREIGN KEY ("from_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wirings_to_service_id_fkey') THEN
    ALTER TABLE "wirings" ADD CONSTRAINT "wirings_to_service_id_fkey" FOREIGN KEY ("to_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_exposures_contest_id_fkey') THEN
    ALTER TABLE "contest_exposures" ADD CONSTRAINT "contest_exposures_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
