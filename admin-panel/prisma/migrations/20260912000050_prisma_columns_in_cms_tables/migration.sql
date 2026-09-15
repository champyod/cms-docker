-- 20260912000050_prisma_columns_in_cms_tables/migration.sql
-- WHY: Adds columns Prisma needs but no other path creates, plus the teams leader FK.
-- WHY ADD COLUMN IF NOT EXISTS: cmsInitDB creates contests/teams/users/admins; on prod those
-- columns already exist (added by earlier patches). Guard makes it safe on both paths.
-- WHY FK guard: pg_constraint check avoids duplicate constraint error on re-apply.
-- Exact types verified against admin-panel/prisma/schema.prisma.

-- contests.is_active BOOLEAN NOT NULL DEFAULT false
ALTER TABLE "contests" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT false;

-- admins.last_login_at TIMESTAMP(3)
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

-- users columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- teams columns
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "organization" TEXT;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "leader_id" INTEGER;

-- FK teams.leader_id -> users.id (guard by constraint name)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_leader_id_fkey') THEN
    ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
