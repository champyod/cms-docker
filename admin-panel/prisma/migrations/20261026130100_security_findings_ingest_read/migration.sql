-- WHY this migration exists: the security feed could write findings but not read them back, and
-- that made every push fail. Prisma upserts with `INSERT … RETURNING`, and Postgres refuses
-- RETURNING when the inserted row is not visible under the table's SELECT policy — the error is
-- 42501 "new row violates row-level security policy", which reads like the INSERT policy is at
-- fault. It is not: `cms_actor_append` already named `system:ingest`. The read policy did not.
--
-- Proven on the production host before this change: the same transaction stamped `cms.actor` =
-- system:ingest, `cms_actor_any(ARRAY['system:ingest'])` returned true, and a plain INSERT
-- succeeded, while Prisma's upsert failed — the only difference being RETURNING.
--
-- The generated policy set (scripts/__generate_rls_sql.sh) carries this clause for every
-- INGEST_WRITE table, so a future regeneration reproduces it. One statement per line, like the
-- generator's own output, so the read policy is greppable by tests/test_rls_ingest_read.sh.

DROP POLICY IF EXISTS cms_actor_read ON public."security_findings";

CREATE POLICY cms_actor_read ON public."security_findings" FOR SELECT TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest']));
