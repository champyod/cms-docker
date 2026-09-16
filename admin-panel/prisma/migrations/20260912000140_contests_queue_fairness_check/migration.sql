-- 20260912000140_contests_queue_fairness_check/migration.sql
-- WHY: src/cms/db/contest.py:269-273 declares queue_fairness_penalty_seconds with
-- CHECK (queue_fairness_penalty_seconds >= 0), but scripts/__fix_db_schema.sql:27
-- retrofitted the column as a bare ADD COLUMN ... NOT NULL DEFAULT 0 with no check.
-- That leaves production at 17 contests checks vs 18 from a fresh cmsInitDB
-- (SQLAlchemy create_all). This migration closes the asymmetry with a stable,
-- explicitly-named check added only when no equivalent already exists.
-- WHY guarded twice: column may be absent on a pre-patch database (skip with
-- NOTICE), and the check may already exist under SQLAlchemy's auto-generated
-- name on a fresh cmsInitDB database or on re-apply (inspect pg_constraint
-- via conrelid + pg_get_constraintdef rather than hard-coding a name).
DO $$ BEGIN
  -- Guard 1: column existence — added by cmsInitDB or by __fix_db_schema.sql
  -- which runs inside `make cms-init` before `make prisma-sync` in the real
  -- flow. If absent, skip cleanly instead of failing.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contests'
      AND column_name = 'queue_fairness_penalty_seconds'
  ) THEN
    RAISE NOTICE 'skip contests_queue_fairness check: column queue_fairness_penalty_seconds does not exist';
    RETURN;
  END IF;

  -- Guard 2: constraint existence — detect ANY check constraint on contests
  -- whose definition already references the column, regardless of its name.
  -- Uses pg_constraint.conrelid to scope to the table and pg_get_constraintdef
  -- to test the expression; avoids guessing SQLAlchemy's auto-generated name.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%queue_fairness_penalty_seconds%'
  ) THEN
    RAISE NOTICE 'skip contests_queue_fairness check: equivalent check constraint already exists';
    RETURN;
  END IF;

  ALTER TABLE "contests" ADD CONSTRAINT "contests_queue_fairness_penalty_seconds_check" CHECK ("queue_fairness_penalty_seconds" >= 0);
END $$;
