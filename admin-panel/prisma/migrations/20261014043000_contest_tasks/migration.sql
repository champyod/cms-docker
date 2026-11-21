-- WHY: a task may now belong to many contests. contest_tasks is the source of
-- truth for membership and per-contest ordering; tasks.contest_id / tasks.num
-- are retired. Everything is guarded: on a fresh install cmsInitDB already
-- created the table from the model (it is CMS-owned, not Prisma-owned), and the
-- legacy columns are already gone.

CREATE TABLE IF NOT EXISTS "contest_tasks" (
    "contest_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "num" INTEGER,
    CONSTRAINT "contest_tasks_pkey" PRIMARY KEY ("contest_id", "task_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contest_tasks_contest_id_num_key" ON "contest_tasks"("contest_id", "num");
CREATE INDEX IF NOT EXISTS "ix_contest_tasks_task_id" ON "contest_tasks"("task_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_tasks_contest_id_fkey') THEN
    ALTER TABLE "contest_tasks" ADD CONSTRAINT "contest_tasks_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contest_tasks_task_id_fkey') THEN
    ALTER TABLE "contest_tasks" ADD CONSTRAINT "contest_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill the legacy one-contest-per-task links before retiring the columns.
-- Guarded because a fresh install never had them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'contest_id') THEN
    INSERT INTO "contest_tasks" ("contest_id", "task_id", "num")
    SELECT "contest_id", "id", "num" FROM "tasks" WHERE "contest_id" IS NOT NULL
    ON CONFLICT ("contest_id", "task_id") DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'contest_id') THEN
    ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_contest_id_name_key";
    ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_contest_id_num_key";
    ALTER TABLE "tasks" DROP COLUMN "contest_id";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'num') THEN
    ALTER TABLE "tasks" DROP COLUMN "num";
  END IF;
END $$;
