-- What the board shows, recorded in the database (item R1).
--
-- WHY a table and not a column: the board's shown set is a set of targets, and each has its own
-- author and reason, so it is rows — not a jsonb blob that no index can reach and no audit trail
-- can describe.
--
-- WHY the shown set is not the CMS-classic "active contest": that default silently picks a
-- contest, which is how a board came to draw another day's columns. With no row here the board
-- shows nothing; the operator adds a contest to the shown set to make it appear.
CREATE TABLE "ranking_config" (
    "id" BIGSERIAL NOT NULL,
    "target_kind" VARCHAR NOT NULL,
    "target_key" VARCHAR NOT NULL,
    "reason" VARCHAR,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "ended_at" TIMESTAMP(3),
    "ended_by" INTEGER,

    CONSTRAINT "ranking_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_ranking_config_target" ON "ranking_config"("target_kind", "target_key");

-- CreateIndex
CREATE INDEX "ix_ranking_config_active" ON "ranking_config"("active");

-- A projected task carries the contest's own id, so a reader scopes the columns it draws by the
-- stable handle the config names rather than by the encoded contest *name*, which a rename moves.
--
-- WHY the add is nullable with no backfill: the row is refilled by the next push, and a task
-- announced before this column existed has no id to invent here — a migration that guessed one
-- would file the task under a contest the reader might then draw. A row with no id is simply not
-- scoped in until the push that carries one arrives.
ALTER TABLE "ranking_tasks" ADD COLUMN "contest_id" INTEGER;

-- CreateIndex
CREATE INDEX "ix_ranking_tasks_contest_id" ON "ranking_tasks"("contest_id");
