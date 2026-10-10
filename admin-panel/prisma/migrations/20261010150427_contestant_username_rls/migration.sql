-- 20261010150427_contestant_username_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --write=contestant_username_rls
-- WHY GENERATED: ENABLE/FORCE plus the cmsuser_all policy per table, all mechanical from schema.prisma.
-- WHY the policy: FORCE makes the table owner subject to RLS too, and every service connects as cmsuser (the owner), so the permissive policy rides along in the same guarded block.
-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.
-- To regenerate: bash scripts/__generate_rls_sql.sh --write=contestant_username_rls
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.contest_usernames') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contest_usernames ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contest_usernames FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contest_usernames';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contest_usernames FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.contest_usernames_history') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contest_usernames_history ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contest_usernames_history FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contest_usernames_history';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contest_usernames_history FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.contestant_group_memberships') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contestant_group_memberships ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contestant_group_memberships FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contestant_group_memberships';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contestant_group_memberships FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.contestant_groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contestant_groups ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contestant_groups FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contestant_groups';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contestant_groups FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.username_policies') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.username_policies ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.username_policies FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.username_policies';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.username_policies FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
