-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "kind" TEXT NOT NULL,
    "tables" VARCHAR[],
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "message" TEXT,
    "manifestTs" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tables" VARCHAR[],
    "intervalMins" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_backup_runs_started_at" ON "backup_runs"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "backup_schedules_name_key" ON "backup_schedules"("name");

-- CreateIndex
CREATE INDEX "ix_backup_schedules_enabled_next_run_at" ON "backup_schedules"("enabled", "nextRunAt");
