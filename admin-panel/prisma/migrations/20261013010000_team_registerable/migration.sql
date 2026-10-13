-- 20261013010000_team_registerable/migration.sql
-- WHY ADD COLUMN IF NOT EXISTS: cmsInitDB creates the teams table on a fresh
-- install; on prod the column may already be present. Guard makes it safe on
-- both paths.
-- Exists so registration can offer only contestant teams: a team for staff is
-- marked registerable = false and is neither offered nor accepted by CWS.

ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "registerable" BOOLEAN NOT NULL DEFAULT true;
