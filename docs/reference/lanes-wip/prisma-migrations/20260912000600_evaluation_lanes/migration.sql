-- 20260912000600_evaluation_lanes/migration.sql
--
-- WHY: evaluation lanes had no storage. Lane membership was reconstructed by scanning
-- audit_log rows for the lane verbs and parsing after_values JSON, capped at 2000 rows — so a
-- lane silently vanished from the board once its last move fell outside that window. This
-- migration gives lanes and their worker bindings real tables.
--
-- GENERATED — do not hand-edit the statements below.
--   Tables, indexes and foreign keys: prisma migrate diff
--     bunx prisma migrate diff \
--       --from-schema-datamodel <pre-change schema.prisma> \
--       --to-schema-datamodel admin-panel/prisma/schema.prisma \
--       --script
--   Row-level security guards: scripts/__generate_rls_sql.sh
--     bash scripts/__generate_rls_sql.sh
--
-- The ONE hand-written deviation is the submissions.lane_id guard, marked inline. submissions
-- is also created by SQLAlchemy cmsInitDB, so the column is added idempotently rather than
-- plainly; the guard changes re-apply behaviour, not the resulting schema, so Prisma drift
-- detection is unaffected.
--
-- WHY ON DELETE SET NULL on all three foreign keys: deleting a worker or an administrator must
-- not delete the lanes or submissions that referenced them. A lane losing its worker goes
-- unbound; a submission losing its lane returns to the unassigned column.

-- AlterTable
-- HAND-WRITTEN GUARD: the only deviation from the generated output. submissions is created by
-- cmsInitDB as well as Prisma, so IF NOT EXISTS keeps re-apply and restore paths from aborting.
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "lane_id" INTEGER;

-- CreateTable
CREATE TABLE "evaluation_workers" (
    "id" SERIAL NOT NULL,
    "shard" INTEGER NOT NULL,
    "name" VARCHAR NOT NULL,
    "host" VARCHAR NOT NULL,
    "port" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(6),

    CONSTRAINT "evaluation_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_lanes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "worker_id" INTEGER,
    "created_by_id" INTEGER,

    CONSTRAINT "evaluation_lanes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_workers_shard_key" ON "evaluation_workers"("shard");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_lanes_name_key" ON "evaluation_lanes"("name");

-- CreateIndex
CREATE INDEX "ix_evaluation_lanes_created_by_id" ON "evaluation_lanes"("created_by_id");

-- CreateIndex
CREATE INDEX "ix_evaluation_lanes_sort_order" ON "evaluation_lanes"("sort_order");

-- CreateIndex
CREATE INDEX "ix_evaluation_lanes_worker_id" ON "evaluation_lanes"("worker_id");

-- CreateIndex
CREATE INDEX "ix_submissions_lane_id" ON "submissions"("lane_id");

-- AddForeignKey
ALTER TABLE "evaluation_lanes" ADD CONSTRAINT "evaluation_lanes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_lanes" ADD CONSTRAINT "evaluation_lanes_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "evaluation_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lane_id_fkey" FOREIGN KEY ("lane_id") REFERENCES "evaluation_lanes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Row level security ──────────────────────────────────────────────────────
-- GENERATED — emitted by scripts/__generate_rls_sql.sh from schema.prisma. Do not hand-edit.
DO $$ BEGIN
  IF to_regclass('public.evaluation_lanes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.evaluation_lanes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.evaluation_lanes FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.evaluation_workers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.evaluation_workers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.evaluation_workers FORCE ROW LEVEL SECURITY';
  END IF;
END $$;

-- WHY hand-authored rather than generated: no generator emits policies — the ENABLE/FORCE guards
-- are generated, policies are authored, exactly as 20260912000400_rls_policies does it.
-- WHY permissive and cmsuser only: the role exists in every database, fresh or restored, so
-- CREATE POLICY never fails at restore time, and the application has no per-user database
-- principal to key a stricter expression on. cms_backup has BYPASSRLS and needs no policy.
DROP POLICY IF EXISTS cmsuser_all ON public.evaluation_workers;
CREATE POLICY cmsuser_all ON public.evaluation_workers FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.evaluation_lanes;
CREATE POLICY cmsuser_all ON public.evaluation_lanes FOR ALL TO cmsuser USING (true) WITH CHECK (true);
