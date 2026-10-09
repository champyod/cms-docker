-- 20261009170100_ranking_console_users_rls/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh
-- WHY GENERATED: this block is mechanical ENABLE/FORCE per table from schema.prisma. Hand-authored policies live in 20260820130000_rls.sql.
-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.
-- To regenerate: bash scripts/__generate_rls_sql.sh
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.ranking_console_users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_console_users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_console_users FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
