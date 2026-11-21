-- 20261013120523_contest_teams_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --write=contest_teams_rls
-- Mechanical ENABLE/FORCE plus the cmsuser_all policy per table; to_regclass keeps each ALTER safe if prisma db push drops or renames a table.
-- To regenerate: bash scripts/__generate_rls_sql.sh --write=contest_teams_rls
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.contest_teams') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contest_teams ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contest_teams FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contest_teams';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contest_teams FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
