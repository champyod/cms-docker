-- 20261014103000_login_surfaces/migration.sql
-- WHY: the login-failure counters live in shared Redis namespaces that cannot name the
-- precise login face -- cms:login: is written by the contest, classic-admin and panel
-- servers alike. This table gives each face a stable key and an operator label, so an
-- attempt or a lockout records only the key and the panel resolves the id and label.
-- WHY guarded everywhere: these objects may already exist on prod from a manual patch,
-- and Prisma re-applies migrations on a rebuilt database, so a fresh install and a
-- re-apply must both be safe. to_regclass checks the table OID; pg_constraint by name.

DO $$ BEGIN
  IF to_regclass('public.login_surfaces') IS NULL THEN
    CREATE TABLE "login_surfaces" (
        "id" SERIAL NOT NULL,
        "key" VARCHAR NOT NULL,
        "label" VARCHAR NOT NULL,
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "login_surfaces_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "login_surfaces_key_key" ON "login_surfaces"("key");

-- Seed the four faces; write-if-absent so a re-apply keeps any operator edit.
INSERT INTO "login_surfaces" ("key", "label") VALUES
  ('contest', 'Contest'),
  ('admin-classic', 'Admin (classic)'),
  ('admin-panel', 'Admin (panel)'),
  ('ranking', 'Ranking')
ON CONFLICT ("key") DO NOTHING;

DO $$ BEGIN
  IF to_regclass('public.security_blocks') IS NOT NULL THEN
    ALTER TABLE "security_blocks" ADD COLUMN IF NOT EXISTS "surface_id" INTEGER;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ix_security_blocks_surface_id" ON "security_blocks"("surface_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'security_blocks_surface_id_fkey') THEN
    ALTER TABLE "security_blocks" ADD CONSTRAINT "security_blocks_surface_id_fkey" FOREIGN KEY ("surface_id") REFERENCES "login_surfaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
