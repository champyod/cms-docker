-- 20261009150100_ranking_tables_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh
-- WHY GENERATED: this block is mechanical ENABLE/FORCE per table from schema.prisma. Hand-authored policies live in 20260820130000_rls.sql.
-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.
-- To regenerate: bash scripts/__generate_rls_sql.sh
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.ranking_contests') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_contests ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_contests FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_overrides') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_overrides ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_overrides FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_settings FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_subchanges') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_subchanges ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_subchanges FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_submissions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_submissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_submissions FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_tasks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_tasks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_tasks FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_teams') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_teams ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_teams FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_users FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
