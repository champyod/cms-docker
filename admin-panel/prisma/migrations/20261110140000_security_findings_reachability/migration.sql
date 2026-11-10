-- WHY a stored column and not a read-time computation: reachability is one rule, and a read path
-- that re-derived it in SQL shipped a second implementation that already disagreed with the
-- classifier on a capitalised `Kernel:` prefix. The verdict is decided once, at ingest, and read.
--
-- WHY the ingest default is 'unknown' and not 'reachable': every row that existed before this
-- column was unjudged, and an unanswered question must never read as a safe one. The ingest path
-- overwrites it on the next push that reports the row.
--
-- WHY there is no RLS statement here: no table is created, so `security_findings` keeps the
-- policies it already has (scripts/__generate_rls_sql.sh --check stays fresh).
--
-- GENERATED — do not hand-edit the statement below.
--   Column: prisma migrate diff --script (from the pre-change schema to schema.prisma)

-- AlterTable
ALTER TABLE "security_findings" ADD COLUMN     "reachability" VARCHAR NOT NULL DEFAULT 'unknown';

-- WHY partial (`WHERE resolved_at IS NULL`): the filter and its count only ever run against the
-- open set, which stays small while the history in the table grows without bound.
-- WHY it carries `last_seen, id`: the default page order is last_seen DESC, and equality on
-- reachability plus that order is one index-only scan instead of a lookup and a sort.

CREATE INDEX IF NOT EXISTS "security_findings_open_reachability_idx"
  ON "security_findings" ("reachability", "last_seen" DESC, "id")
  WHERE "resolved_at" IS NULL;
