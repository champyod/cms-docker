-- WHY these indexes exist: the page and the signal job both ask questions about the UNRESOLVED set
-- only, and every one of them was answered by scanning the whole table. Measured on a live host with
-- 34,609 open findings: 55 ms to group by source, 53 ms to group by severity, 21 ms to count the
-- rootfs rows that name a fix — 129 ms of a page render that now reads twenty-five rows.
--
-- WHY partial (`WHERE resolved_at IS NULL`): history is never pruned — every finding a producer stops
-- reporting stays in the table with `resolved_at` set — so the open set is the small part that grows
-- slowly while the table grows without bound. A partial index is that much smaller than a full one and
-- is used exactly by the queries that say `resolved_at: null`.
--
-- WHY these four: one per query shape the read path issues. `(source, severity)` serves both group-bys
-- as an index-only scan; `(last_seen DESC, id)` is the default page order; `(first_seen)` is the aged
-- count; the last one serves the rootfs "has a fix version" count without touching the heap.

CREATE INDEX IF NOT EXISTS "security_findings_open_source_severity_idx"
  ON "security_findings" ("source", "severity")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "security_findings_open_last_seen_idx"
  ON "security_findings" ("last_seen" DESC, "id")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "security_findings_open_first_seen_idx"
  ON "security_findings" ("first_seen")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "security_findings_open_fix_idx"
  ON "security_findings" ("source")
  WHERE "resolved_at" IS NULL AND "available" IS NOT NULL;
