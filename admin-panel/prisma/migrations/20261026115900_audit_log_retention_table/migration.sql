-- 20261026115900_audit_log_retention_table/migration.sql
--
-- The prune ledger. Prisma's own DDL for `model audit_log_retention`, split from the RLS guards in
-- 20261026120000_audit_log_retention so that the generated file stays exactly what the generator
-- emitted (scripts/__generate_rls_sql.sh --write=audit_log_retention) and this one stays the table.
--
-- WHY a table and not a column on audit_log: the row that records a prune would be the first row
-- the next prune removes. The proof that a gap in the log is a retention decision has to live
-- outside the chain the decision cuts, and it has to survive the next prune.

CREATE TABLE IF NOT EXISTS "audit_log_retention" (
    "id" BIGSERIAL NOT NULL,
    "performed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window_days" INTEGER NOT NULL,
    "cutoff" TIMESTAMP(6) NOT NULL,
    "deleted_count" INTEGER NOT NULL,
    "first_deleted_id" BIGINT,
    "last_deleted_id" BIGINT,
    "last_deleted_hash" VARCHAR,
    "retained_from_id" BIGINT,
    "actor" VARCHAR NOT NULL,
    "entry_hash" VARCHAR,
    "prev_hash" VARCHAR,

    CONSTRAINT "audit_log_retention_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ix_audit_log_retention_performed_at"
    ON "audit_log_retention"("performed_at");
