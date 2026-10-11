-- 20261012000000_rls_policies_backfill/migration.sql
-- WHY: tables added after 20260912000400_rls_policies got ENABLE+FORCE ROW LEVEL
-- SECURITY but no policy. With FORCE and no policy a table returns zero rows to the
-- owner and rejects its inserts, so the backup ledger read empty and never recorded a
-- run. Backfill the permissive owner policy the older tables carry.

DROP POLICY IF EXISTS cmsuser_all ON public.backup_runs;
CREATE POLICY cmsuser_all ON public.backup_runs FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.backup_schedules;
CREATE POLICY cmsuser_all ON public.backup_schedules FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.backup_locations;
CREATE POLICY cmsuser_all ON public.backup_locations FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.security_blocks;
CREATE POLICY cmsuser_all ON public.security_blocks FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_console_users;
CREATE POLICY cmsuser_all ON public.ranking_console_users FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_contests;
CREATE POLICY cmsuser_all ON public.ranking_contests FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_overrides;
CREATE POLICY cmsuser_all ON public.ranking_overrides FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_settings;
CREATE POLICY cmsuser_all ON public.ranking_settings FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_subchanges;
CREATE POLICY cmsuser_all ON public.ranking_subchanges FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_submissions;
CREATE POLICY cmsuser_all ON public.ranking_submissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_tasks;
CREATE POLICY cmsuser_all ON public.ranking_tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_teams;
CREATE POLICY cmsuser_all ON public.ranking_teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cmsuser_all ON public.ranking_users;
CREATE POLICY cmsuser_all ON public.ranking_users FOR ALL TO cmsuser USING (true) WITH CHECK (true);
