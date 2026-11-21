-- CreateTable
CREATE TABLE "ranking_contests" (
    "key" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "begin" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "score_precision" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_contests_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_tasks" (
    "key" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "short_name" VARCHAR NOT NULL,
    "contest" VARCHAR NOT NULL,
    "max_score" DOUBLE PRECISION NOT NULL,
    "score_precision" INTEGER NOT NULL,
    "extra_headers" JSONB NOT NULL,
    "display_order" INTEGER NOT NULL,
    "score_mode" VARCHAR NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_tasks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_teams" (
    "key" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_teams_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_users" (
    "key" VARCHAR NOT NULL,
    "f_name" VARCHAR NOT NULL,
    "l_name" VARCHAR NOT NULL,
    "team" VARCHAR,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_users_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_submissions" (
    "key" VARCHAR NOT NULL,
    "user" VARCHAR NOT NULL,
    "task" VARCHAR NOT NULL,
    "time" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_submissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_subchanges" (
    "key" VARCHAR NOT NULL,
    "submission" VARCHAR NOT NULL,
    "time" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "token" BOOLEAN,
    "extra" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_subchanges_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ranking_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR,
    "subtitle" VARCHAR,
    "organisation" VARCHAR,
    "logo_asset" VARCHAR,
    "favicon_asset" VARCHAR,
    "theme" JSONB,
    "columns" JSONB,
    "score_format" JSONB,
    "footer_text" VARCHAR,
    "credits_text" VARCHAR,
    "access_mode" VARCHAR NOT NULL DEFAULT 'public',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,

    CONSTRAINT "ranking_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_overrides" (
    "id" BIGSERIAL NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "target_kind" VARCHAR NOT NULL,
    "target_key" VARCHAR NOT NULL,
    "action" VARCHAR NOT NULL,
    "payload" JSONB,
    "reason" VARCHAR,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "ended_at" TIMESTAMP(3),
    "ended_by" INTEGER,

    CONSTRAINT "ranking_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_ranking_tasks_contest" ON "ranking_tasks"("contest");

-- CreateIndex
CREATE INDEX "ix_ranking_tasks_order" ON "ranking_tasks"("display_order");

-- CreateIndex
CREATE INDEX "ix_ranking_users_team" ON "ranking_users"("team");

-- CreateIndex
CREATE INDEX "ix_ranking_submissions_user_task" ON "ranking_submissions"("user", "task");

-- CreateIndex
CREATE INDEX "ix_ranking_submissions_time" ON "ranking_submissions"("time");

-- CreateIndex
CREATE INDEX "ix_ranking_subchanges_submission" ON "ranking_subchanges"("submission");

-- CreateIndex
CREATE INDEX "ix_ranking_subchanges_time" ON "ranking_subchanges"("time");

-- CreateIndex
CREATE INDEX "ix_ranking_overrides_active" ON "ranking_overrides"("active");

-- CreateIndex
CREATE INDEX "ix_ranking_overrides_contest" ON "ranking_overrides"("contest_id", "active", "target_kind");

-- CreateIndex
CREATE INDEX "ix_ranking_overrides_target" ON "ranking_overrides"("target_kind", "target_key");
