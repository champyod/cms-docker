-- 20260912000000_baseline_tables/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: prisma migrate diff --from-empty --to-schema-datamodel <schema> --script
-- WHY GENERATED: squashed baseline — creates every table, index, foreign key and enum from schema.prisma.
-- To regenerate: prisma migrate diff --from-empty --to-schema-datamodel admin-panel/prisma/schema.prisma --script

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "compilation_outcome" AS ENUM ('ok', 'fail');

-- CreateEnum
CREATE TYPE "evaluation_outcome" AS ENUM ('ok');

-- CreateEnum
CREATE TYPE "feedback_level" AS ENUM ('full', 'restricted', 'oi_restricted');

-- CreateEnum
CREATE TYPE "score_mode" AS ENUM ('max_tokened_last', 'max', 'max_subtask');

-- CreateEnum
CREATE TYPE "token_mode" AS ENUM ('disabled', 'finite', 'infinite');

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "username" VARCHAR NOT NULL,
    "authentication" VARCHAR NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "subject" VARCHAR NOT NULL,
    "text" VARCHAR NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "admin_id" INTEGER,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" VARCHAR NOT NULL,
    "allowed_localizations" VARCHAR[],
    "languages" VARCHAR[],
    "submissions_download_allowed" BOOLEAN NOT NULL,
    "allow_questions" BOOLEAN NOT NULL,
    "allow_user_tests" BOOLEAN NOT NULL,
    "allow_unofficial_submission_before_analysis_mode" BOOLEAN NOT NULL,
    "block_hidden_participations" BOOLEAN NOT NULL,
    "allow_password_authentication" BOOLEAN NOT NULL,
    "allow_registration" BOOLEAN NOT NULL,
    "ip_restriction" BOOLEAN NOT NULL,
    "ip_autologin" BOOLEAN NOT NULL,
    "token_mode" "token_mode" NOT NULL,
    "token_max_number" INTEGER,
    "token_min_interval" interval,
    "token_gen_initial" INTEGER NOT NULL,
    "token_gen_number" INTEGER NOT NULL,
    "token_gen_interval" interval,
    "token_gen_max" INTEGER,
    "start" TIMESTAMP(6) NOT NULL,
    "stop" TIMESTAMP(6) NOT NULL,
    "analysis_enabled" BOOLEAN NOT NULL,
    "analysis_start" TIMESTAMP(6) NOT NULL,
    "analysis_stop" TIMESTAMP(6) NOT NULL,
    "timezone" VARCHAR,
    "per_user_time" interval,
    "max_submission_number" INTEGER,
    "max_user_test_number" INTEGER,
    "min_submission_interval" interval,
    "min_submission_interval_grace_period" interval,
    "min_user_test_interval" interval,
    "queue_fairness_penalty_seconds" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "score_precision" INTEGER NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "description" VARCHAR NOT NULL,
    "autojudge" BOOLEAN NOT NULL,
    "time_limit" DOUBLE PRECISION,
    "memory_limit" BIGINT,
    "task_type" VARCHAR NOT NULL,
    "task_type_parameters" JSONB NOT NULL,
    "score_type" VARCHAR NOT NULL,
    "score_type_parameters" JSONB NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "testcase_id" INTEGER NOT NULL,
    "outcome" VARCHAR,
    "text" VARCHAR[],
    "execution_time" DOUBLE PRECISION,
    "execution_wall_clock_time" DOUBLE PRECISION,
    "execution_memory" BIGINT,
    "evaluation_shard" INTEGER,
    "evaluation_sandbox_paths" VARCHAR[],
    "evaluation_sandbox_digests" VARCHAR[],

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executables" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "executables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fsobjects" (
    "digest" VARCHAR NOT NULL,
    "loid" OID NOT NULL,
    "description" VARCHAR,

    CONSTRAINT "fsobjects_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "managers" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "subject" VARCHAR NOT NULL,
    "text" VARCHAR NOT NULL,
    "participation_id" INTEGER NOT NULL,
    "admin_id" INTEGER,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" SERIAL NOT NULL,
    "ip" cidr[],
    "starting_time" TIMESTAMP(6),
    "delay_time" interval NOT NULL,
    "extra_time" interval NOT NULL,
    "password" VARCHAR,
    "hidden" BOOLEAN NOT NULL,
    "unrestricted" BOOLEAN NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "team_id" INTEGER,

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" SERIAL NOT NULL,
    "question_timestamp" TIMESTAMP(6) NOT NULL,
    "subject" VARCHAR NOT NULL,
    "text" VARCHAR NOT NULL,
    "reply_timestamp" TIMESTAMP(6),
    "ignored" BOOLEAN NOT NULL,
    "reply_subject" VARCHAR,
    "reply_text" VARCHAR,
    "participation_id" INTEGER NOT NULL,
    "admin_id" INTEGER,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statements" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "language" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_results" (
    "submission_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "compilation_outcome" "compilation_outcome",
    "compilation_text" VARCHAR[],
    "compilation_tries" INTEGER NOT NULL,
    "compilation_stdout" VARCHAR,
    "compilation_stderr" VARCHAR,
    "compilation_time" DOUBLE PRECISION,
    "compilation_wall_clock_time" DOUBLE PRECISION,
    "compilation_memory" BIGINT,
    "compilation_shard" INTEGER,
    "compilation_sandbox_paths" VARCHAR[],
    "compilation_sandbox_digests" VARCHAR[],
    "evaluation_outcome" "evaluation_outcome",
    "evaluation_tries" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "score_details" JSONB,
    "scored_at" TIMESTAMP(6),
    "public_score" DOUBLE PRECISION,
    "public_score_details" JSONB,
    "ranking_score_details" VARCHAR[],

    CONSTRAINT "submission_results_pkey" PRIMARY KEY ("submission_id","dataset_id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "opaque_id" BIGINT NOT NULL,
    "id" SERIAL NOT NULL,
    "participation_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "language" VARCHAR,
    "comment" VARCHAR NOT NULL,
    "official" BOOLEAN NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "num" INTEGER,
    "contest_id" INTEGER,
    "name" VARCHAR NOT NULL,
    "title" VARCHAR NOT NULL,
    "submission_format" VARCHAR[],
    "primary_statements" VARCHAR[],
    "allowed_languages" VARCHAR[],
    "token_mode" "token_mode" NOT NULL,
    "token_max_number" INTEGER,
    "token_min_interval" interval NOT NULL,
    "token_gen_initial" INTEGER NOT NULL,
    "token_gen_number" INTEGER NOT NULL,
    "token_gen_interval" interval NOT NULL,
    "token_gen_max" INTEGER,
    "max_submission_number" INTEGER,
    "max_user_test_number" INTEGER,
    "min_submission_interval" interval,
    "min_user_test_interval" interval,
    "feedback_level" "feedback_level" NOT NULL,
    "score_precision" INTEGER NOT NULL,
    "score_mode" "score_mode" NOT NULL,
    "active_dataset_id" INTEGER,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "organization" TEXT,
    "leader_id" INTEGER,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testcases" (
    "id" SERIAL NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "codename" VARCHAR NOT NULL,
    "public" BOOLEAN NOT NULL,
    "input" VARCHAR NOT NULL,
    "output" VARCHAR NOT NULL,

    CONSTRAINT "testcases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_test_executables" (
    "id" SERIAL NOT NULL,
    "user_test_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "user_test_executables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_test_files" (
    "id" SERIAL NOT NULL,
    "user_test_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "user_test_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_test_managers" (
    "id" SERIAL NOT NULL,
    "user_test_id" INTEGER NOT NULL,
    "filename" VARCHAR NOT NULL,
    "digest" VARCHAR NOT NULL,

    CONSTRAINT "user_test_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_test_results" (
    "user_test_id" INTEGER NOT NULL,
    "dataset_id" INTEGER NOT NULL,
    "output" VARCHAR,
    "compilation_outcome" VARCHAR,
    "compilation_text" VARCHAR[],
    "compilation_tries" INTEGER NOT NULL,
    "compilation_stdout" VARCHAR,
    "compilation_stderr" VARCHAR,
    "compilation_time" DOUBLE PRECISION,
    "compilation_wall_clock_time" DOUBLE PRECISION,
    "compilation_memory" BIGINT,
    "compilation_shard" INTEGER,
    "compilation_sandbox_paths" VARCHAR[],
    "compilation_sandbox_digests" VARCHAR[],
    "evaluation_outcome" VARCHAR,
    "evaluation_text" VARCHAR[],
    "evaluation_tries" INTEGER NOT NULL,
    "execution_time" DOUBLE PRECISION,
    "execution_wall_clock_time" DOUBLE PRECISION,
    "execution_memory" BIGINT,
    "evaluation_shard" INTEGER,
    "evaluation_sandbox_paths" VARCHAR[],
    "evaluation_sandbox_digests" VARCHAR[],

    CONSTRAINT "user_test_results_pkey" PRIMARY KEY ("user_test_id","dataset_id")
);

-- CreateTable
CREATE TABLE "user_tests" (
    "id" SERIAL NOT NULL,
    "participation_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "language" VARCHAR,
    "input" VARCHAR NOT NULL,

    CONSTRAINT "user_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_targets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 60,
    "timeout" INTEGER NOT NULL DEFAULT 5,
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "alertDiscord" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR NOT NULL,
    "last_name" VARCHAR NOT NULL,
    "username" VARCHAR NOT NULL,
    "password" VARCHAR NOT NULL,
    "email" VARCHAR,
    "timezone" VARCHAR,
    "preferred_languages" VARCHAR[],
    "last_login_at" TIMESTAMP(3),
    "status" TEXT,
    "organization" TEXT,
    "country" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR NOT NULL,
    "module" VARCHAR NOT NULL,
    "verb" VARCHAR NOT NULL,
    "description" VARCHAR,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" VARCHAR,
    "is_seeded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_permissions" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "group_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_groups" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,

    CONSTRAINT "admin_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permission_overrides" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "effect" VARCHAR NOT NULL,
    "reason" VARCHAR,

    CONSTRAINT "admin_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verb" VARCHAR NOT NULL,
    "entity" VARCHAR NOT NULL,
    "entity_id" VARCHAR,
    "before_values" JSONB,
    "after_values" JSONB,
    "reason" VARCHAR,
    "ip" VARCHAR,
    "session_id" VARCHAR,
    "result" VARCHAR NOT NULL,
    "entry_hash" VARCHAR,
    "prev_hash" VARCHAR,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE INDEX "ix_announcements_admin_id" ON "announcements"("admin_id");

-- CreateIndex
CREATE INDEX "ix_announcements_contest_id" ON "announcements"("contest_id");

-- CreateIndex
CREATE INDEX "ix_attachments_task_id" ON "attachments"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_task_id_filename_key" ON "attachments"("task_id", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "contests_name_key" ON "contests"("name");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_id_task_id_key" ON "datasets"("id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_task_id_description_key" ON "datasets"("task_id", "description");

-- CreateIndex
CREATE INDEX "ix_evaluations_dataset_id" ON "evaluations"("dataset_id");

-- CreateIndex
CREATE INDEX "ix_evaluations_submission_id" ON "evaluations"("submission_id");

-- CreateIndex
CREATE INDEX "ix_evaluations_testcase_id" ON "evaluations"("testcase_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_submission_id_dataset_id_testcase_id_key" ON "evaluations"("submission_id", "dataset_id", "testcase_id");

-- CreateIndex
CREATE INDEX "ix_executables_dataset_id" ON "executables"("dataset_id");

-- CreateIndex
CREATE INDEX "ix_executables_submission_id" ON "executables"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "executables_submission_id_dataset_id_filename_key" ON "executables"("submission_id", "dataset_id", "filename");

-- CreateIndex
CREATE INDEX "ix_files_submission_id" ON "files"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_submission_id_filename_key" ON "files"("submission_id", "filename");

-- CreateIndex
CREATE INDEX "ix_managers_dataset_id" ON "managers"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "managers_dataset_id_filename_key" ON "managers"("dataset_id", "filename");

-- CreateIndex
CREATE INDEX "ix_messages_admin_id" ON "messages"("admin_id");

-- CreateIndex
CREATE INDEX "ix_messages_participation_id" ON "messages"("participation_id");

-- CreateIndex
CREATE INDEX "ix_participations_contest_id" ON "participations"("contest_id");

-- CreateIndex
CREATE INDEX "ix_participations_user_id" ON "participations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participations_contest_id_user_id_key" ON "participations"("contest_id", "user_id");

-- CreateIndex
CREATE INDEX "ix_questions_admin_id" ON "questions"("admin_id");

-- CreateIndex
CREATE INDEX "ix_questions_participation_id" ON "questions"("participation_id");

-- CreateIndex
CREATE INDEX "ix_statements_task_id" ON "statements"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "statements_task_id_language_key" ON "statements"("task_id", "language");

-- CreateIndex
CREATE INDEX "ix_submissions_participation_id" ON "submissions"("participation_id");

-- CreateIndex
CREATE INDEX "ix_submissions_task_id" ON "submissions"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "participation_opaque_unique" ON "submissions"("participation_id", "opaque_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_name_key" ON "tasks"("name");

-- CreateIndex
CREATE INDEX "ix_tasks_contest_id" ON "tasks"("contest_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_contest_id_name_key" ON "tasks"("contest_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_contest_id_num_key" ON "tasks"("contest_id", "num");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_active_dataset_id_key" ON "tasks"("id", "active_dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_code_key" ON "teams"("code");

-- CreateIndex
CREATE INDEX "ix_testcases_dataset_id" ON "testcases"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "testcases_dataset_id_codename_key" ON "testcases"("dataset_id", "codename");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_submission_id_key" ON "tokens"("submission_id");

-- CreateIndex
CREATE INDEX "ix_tokens_submission_id" ON "tokens"("submission_id");

-- CreateIndex
CREATE INDEX "ix_user_test_executables_dataset_id" ON "user_test_executables"("dataset_id");

-- CreateIndex
CREATE INDEX "ix_user_test_executables_user_test_id" ON "user_test_executables"("user_test_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_test_executables_user_test_id_dataset_id_filename_key" ON "user_test_executables"("user_test_id", "dataset_id", "filename");

-- CreateIndex
CREATE INDEX "ix_user_test_files_user_test_id" ON "user_test_files"("user_test_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_test_files_user_test_id_filename_key" ON "user_test_files"("user_test_id", "filename");

-- CreateIndex
CREATE INDEX "ix_user_test_managers_user_test_id" ON "user_test_managers"("user_test_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_test_managers_user_test_id_filename_key" ON "user_test_managers"("user_test_id", "filename");

-- CreateIndex
CREATE INDEX "ix_user_tests_participation_id" ON "user_tests"("participation_id");

-- CreateIndex
CREATE INDEX "ix_user_tests_task_id" ON "user_tests"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "ix_permissions_module" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE INDEX "ix_group_permissions_group_id" ON "group_permissions"("group_id");

-- CreateIndex
CREATE INDEX "ix_group_permissions_permission_id" ON "group_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_permissions_group_id_permission_id_key" ON "group_permissions"("group_id", "permission_id");

-- CreateIndex
CREATE INDEX "ix_admin_groups_admin_id" ON "admin_groups"("admin_id");

-- CreateIndex
CREATE INDEX "ix_admin_groups_group_id" ON "admin_groups"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_groups_admin_id_group_id_key" ON "admin_groups"("admin_id", "group_id");

-- CreateIndex
CREATE INDEX "ix_admin_permission_overrides_admin_id" ON "admin_permission_overrides"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permission_overrides_admin_id_permission_id_key" ON "admin_permission_overrides"("admin_id", "permission_id");

-- CreateIndex
CREATE INDEX "ix_audit_log_actor_id" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "ix_audit_log_entity" ON "audit_log"("entity");

-- CreateIndex
CREATE INDEX "ix_audit_log_timestamp" ON "audit_log"("timestamp");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submission_id_dataset_id_fkey" FOREIGN KEY ("submission_id", "dataset_id") REFERENCES "submission_results"("submission_id", "dataset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_testcase_id_fkey" FOREIGN KEY ("testcase_id") REFERENCES "testcases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executables" ADD CONSTRAINT "executables_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executables" ADD CONSTRAINT "executables_submission_id_dataset_id_fkey" FOREIGN KEY ("submission_id", "dataset_id") REFERENCES "submission_results"("submission_id", "dataset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executables" ADD CONSTRAINT "executables_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "managers" ADD CONSTRAINT "managers_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "fk_active_dataset_id" FOREIGN KEY ("id", "active_dataset_id") REFERENCES "datasets"("task_id", "id") ON DELETE SET NULL ON UPDATE SET NULL;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testcases" ADD CONSTRAINT "testcases_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_executables" ADD CONSTRAINT "user_test_executables_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_executables" ADD CONSTRAINT "user_test_executables_user_test_id_dataset_id_fkey" FOREIGN KEY ("user_test_id", "dataset_id") REFERENCES "user_test_results"("user_test_id", "dataset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_executables" ADD CONSTRAINT "user_test_executables_user_test_id_fkey" FOREIGN KEY ("user_test_id") REFERENCES "user_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_files" ADD CONSTRAINT "user_test_files_user_test_id_fkey" FOREIGN KEY ("user_test_id") REFERENCES "user_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_managers" ADD CONSTRAINT "user_test_managers_user_test_id_fkey" FOREIGN KEY ("user_test_id") REFERENCES "user_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_results" ADD CONSTRAINT "user_test_results_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_test_results" ADD CONSTRAINT "user_test_results_user_test_id_fkey" FOREIGN KEY ("user_test_id") REFERENCES "user_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tests" ADD CONSTRAINT "user_tests_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tests" ADD CONSTRAINT "user_tests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_groups" ADD CONSTRAINT "admin_groups_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_groups" ADD CONSTRAINT "admin_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

