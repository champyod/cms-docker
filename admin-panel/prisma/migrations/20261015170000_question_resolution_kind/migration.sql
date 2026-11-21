-- 20261015170000_question_resolution_kind/migration.sql
-- A reply records whether the statement itself answered the question or an answer had to.
--
-- WHY nullable and without a default: the marker is only known once a grader answers, every row
-- written before the column existed carries none, and a reader that ignores the column is
-- unchanged — so the statement below never blocks on existing rows and never invents a value.
--
-- WHY the type is guarded: cmsInitDB (SQLAlchemy metadata.create_all) builds the enum types of
-- the core tables before Prisma ever runs (see 20260910000000_baseline_marker), so on every
-- database this repo creates a bare CREATE TYPE fails with duplicate_object. The guard keeps the
-- statement workable where a hand-rebuilt database has the type missing.
-- WHY the column is guarded: the re-apply on a core table that
-- 20260912000050_prisma_columns_in_cms_tables guards for, and the same table cmsInitDB creates.
-- Both statements assume the core schema exists, as every migration touching a core table does.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'question_resolution_kind') THEN
    CREATE TYPE "question_resolution_kind" AS ENUM ('clarification_needed', 'settled_by_statement');
  END IF;
END $$;

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "resolution_kind" "question_resolution_kind";
