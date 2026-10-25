-- WHY this migration exists: every accepted security-feed push writes exactly one `audit_log` row,
-- and the append policy named only staff. `system:ingest` is deliberately not staff, so all 139
-- audit rows of the first real host scan were refused — the pushes succeeded and the trail that
-- records them did not. The panel's own signal caught it ("cannot write audit logs"), which is how
-- this was found; the fix is not to stop writing the trail but to let the named machine identity
-- write the row it is entitled to write.
--
-- What stays enforced: `audit_log` is still append-only (no UPDATE policy, guard trigger), and the
-- attribution rule is unchanged — an admin actor may only file a row under itself, and only a system
-- identity may name another actor. The feed names the seeded root admin on behalf of the producer,
-- which is exactly what that rule permits for a `system:` identity.
--
-- Kept on one line per statement, like the generator's output, so tests/test_rls_ingest_read.sh can
-- assert it.

DROP POLICY IF EXISTS cms_actor_append ON public."audit_log";

CREATE POLICY cms_actor_append ON public."audit_log" FOR INSERT TO cmsuser WITH CHECK ((public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest'])) AND (public.cms_actor_admin_id() IS NULL OR actor_id IS NULL OR actor_id = public.cms_actor_admin_id()));
