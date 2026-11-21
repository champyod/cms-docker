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
