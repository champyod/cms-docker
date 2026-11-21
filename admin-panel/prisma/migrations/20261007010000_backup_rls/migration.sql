-- 20261007010000_backup_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh
-- Mechanical ENABLE/FORCE per table; policies are hand-authored in 20260820130000_rls.sql.
-- To regenerate: bash scripts/__generate_rls_sql.sh
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.backup_runs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.backup_runs FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.backup_schedules') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.backup_schedules ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.backup_schedules FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
