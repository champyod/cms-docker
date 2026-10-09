-- CreateTable
CREATE TABLE "security_blocks" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR NOT NULL,
    "source" VARCHAR NOT NULL,
    "ip" VARCHAR,
    "subject" VARCHAR,
    "detail" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_security_blocks_active_kind" ON "security_blocks"("active", "kind");

-- CreateIndex
CREATE INDEX "ix_security_blocks_ip" ON "security_blocks"("ip");

-- CreateIndex
CREATE INDEX "ix_security_blocks_started_at" ON "security_blocks"("started_at");
