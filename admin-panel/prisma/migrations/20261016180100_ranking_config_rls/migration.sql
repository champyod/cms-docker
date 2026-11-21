-- 20261016180100_ranking_config_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --write=ranking_config_rls
-- Renamed after generation: the generator stamps the current UTC clock, which ordered this block
-- before 20261016180000_ranking_config, and to_regclass makes a block that runs before its table
-- simply no-op — so the RLS guards must apply after the table exists.
-- Mechanical ENABLE/FORCE plus the cmsuser_all policy per table; to_regclass keeps each ALTER safe if prisma db push drops or renames a table.
-- To regenerate: bash scripts/__generate_rls_sql.sh --write=ranking_config_rls
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.ranking_config') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_config ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_config FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.ranking_config';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.ranking_config FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
