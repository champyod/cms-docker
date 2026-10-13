-- 20261013173321_service_wiring/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --write=service_wiring
-- Mechanical ENABLE/FORCE plus the cmsuser_all policy per table; to_regclass keeps each ALTER safe if prisma db push drops or renames a table.
-- To regenerate: bash scripts/__generate_rls_sql.sh --write=service_wiring
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.contest_exposures') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contest_exposures ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contest_exposures FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.contest_exposures';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.contest_exposures FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.services ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.services FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.services';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.services FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.wirings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.wirings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.wirings FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.wirings';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.wirings FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;
