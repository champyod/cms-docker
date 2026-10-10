-- CreateEnum
CREATE TYPE "username_policy_scope" AS ENUM ('contest', 'user', 'group');

-- CreateEnum
CREATE TYPE "username_policy" AS ENUM ('allow', 'deny');

-- CreateTable
CREATE TABLE "contestant_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" VARCHAR,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contestant_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contestant_group_memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contestant_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "username_policies" (
    "id" SERIAL NOT NULL,
    "scope" "username_policy_scope" NOT NULL,
    "scope_id" INTEGER NOT NULL,
    "policy" "username_policy" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,

    CONSTRAINT "username_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_usernames" (
    "id" SERIAL NOT NULL,
    "participation_id" INTEGER NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "username" VARCHAR NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_admin_id" INTEGER,

    CONSTRAINT "contest_usernames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_usernames_history" (
    "id" SERIAL NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "username" VARCHAR,
    "set_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "set_by_admin_id" INTEGER,

    CONSTRAINT "contest_usernames_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contestant_groups_name_key" ON "contestant_groups"("name");

-- CreateIndex
CREATE INDEX "ix_contestant_group_memberships_user_id" ON "contestant_group_memberships"("user_id");

-- CreateIndex
CREATE INDEX "ix_contestant_group_memberships_group_id" ON "contestant_group_memberships"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "contestant_group_memberships_user_id_group_id_key" ON "contestant_group_memberships"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "ix_username_policies_scope_id" ON "username_policies"("scope_id");

-- CreateIndex
CREATE INDEX "ix_username_policies_updated_by" ON "username_policies"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "username_policies_scope_scope_id_key" ON "username_policies"("scope", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_usernames_participation_id_key" ON "contest_usernames"("participation_id");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_contest_id" ON "contest_usernames"("contest_id");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_user_id" ON "contest_usernames"("user_id");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_updated_by_admin_id" ON "contest_usernames"("updated_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_usernames_contest_id_username_key" ON "contest_usernames"("contest_id", "username");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_history_contest_id" ON "contest_usernames_history"("contest_id");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_history_user_id" ON "contest_usernames_history"("user_id");

-- CreateIndex
CREATE INDEX "ix_contest_usernames_history_set_by_admin_id" ON "contest_usernames_history"("set_by_admin_id");

-- AddForeignKey
ALTER TABLE "contestant_group_memberships" ADD CONSTRAINT "contestant_group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "contestant_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contestant_group_memberships" ADD CONSTRAINT "contestant_group_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "username_policies" ADD CONSTRAINT "username_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_usernames" ADD CONSTRAINT "contest_usernames_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_usernames" ADD CONSTRAINT "contest_usernames_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_usernames" ADD CONSTRAINT "contest_usernames_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_usernames" ADD CONSTRAINT "contest_usernames_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_usernames_history" ADD CONSTRAINT "contest_usernames_history_set_by_admin_id_fkey" FOREIGN KEY ("set_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

