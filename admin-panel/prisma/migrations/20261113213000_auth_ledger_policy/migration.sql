-- 20261113213000_auth_ledger_policy/migration.sql — GENERATED — do not hand-edit
-- Generator: scripts/__generate_rls_sql.sh --emit-policies (the security_blocks block, verbatim)
-- WHY its own migration: the full policy set is rewritten in place inside a migration a database has
-- already applied, so such a database would never see this change. This file carries only the delta,
-- and every statement is idempotent (DROP POLICY IF EXISTS before each CREATE).

-- security_blocks
-- AUTH_LEDGER: staff own this table, and the pre-session login path appends to it under
-- system:auth — an exemption it must read before a session exists, and a lockout it must
-- record when a credential is refused. WHY three policies rather than the AUTH_BOOTSTRAP
-- predicate: that one also admits DELETE, so it would let a credential check erase a block.
-- A login path may read, append and extend the ledger; retiring a row stays a staff act.
DROP POLICY IF EXISTS cmsuser_all ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_all ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_read ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_append ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_update ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_delete ON public.security_blocks;
CREATE POLICY cms_actor_read ON public.security_blocks FOR SELECT TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:auth']));
CREATE POLICY cms_actor_append ON public.security_blocks FOR INSERT TO cmsuser WITH CHECK (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:auth']));
CREATE POLICY cms_actor_update ON public.security_blocks FOR UPDATE TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:auth'])) WITH CHECK (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:auth']));
CREATE POLICY cms_actor_delete ON public.security_blocks FOR DELETE TO cmsuser USING (public.cms_actor_is_staff());
