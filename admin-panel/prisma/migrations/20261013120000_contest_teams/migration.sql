-- 20261013120000_contest_teams/migration.sql
-- WHY: registration must be able to say "contestants only" for ONE contest. This
-- join table is a per-contest roster: a row overrides teams.registerable for that
-- contest, and a team with no row falls back to its own registerable flag, so a
-- contest with no rows keeps today's behaviour and an upgrade opens nothing.
-- WHY IF NOT EXISTS / pg_constraint guards: the table may already exist on prod
-- from a manual patch; the guards keep both a fresh install and a re-apply safe.

CREATE TABLE IF NOT EXISTS "contest_teams" (
    "contest_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "registerable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "contest_teams_pkey" PRIMARY KEY ("contest_id", "team_id")
);

CREATE INDEX IF NOT EXISTS "ix_contest_teams_team_id" ON "contest_teams"("team_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_teams_contest_id_fkey') THEN
    ALTER TABLE "contest_teams" ADD CONSTRAINT "contest_teams_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_teams_team_id_fkey') THEN
    ALTER TABLE "contest_teams" ADD CONSTRAINT "contest_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
