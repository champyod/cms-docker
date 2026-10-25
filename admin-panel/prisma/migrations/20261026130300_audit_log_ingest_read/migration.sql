-- WHY this migration exists: the previous one let `system:ingest` append the audit row every feed
-- push owes. It still failed — same cause as the findings table one migration earlier, and the same
-- 42501. Postgres refuses `INSERT … RETURNING` when the new row is not visible under the table's
-- SELECT policy, and Prisma's `create()` returns the row. The append grant was there; the read grant
-- was not.
--
-- So the rule is now stated once, structurally: any table an ingest identity may append to, it may
-- also read back. tests/test_rls_ingest_read.sh asserts exactly that across the generated policy set,
-- rather than naming tables one at a time.
--
-- Nothing about audit_log's guarantees moves: still append-only (no UPDATE policy, guard trigger),
-- still no deleting inside the retention window, still one identity that may prune, and the
-- attribution rule on INSERT is untouched.

DROP POLICY IF EXISTS cms_actor_read ON public."audit_log";

CREATE POLICY cms_actor_read ON public."audit_log" FOR SELECT TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:audit-retention']) OR public.cms_actor_any(ARRAY['system:ingest']));
