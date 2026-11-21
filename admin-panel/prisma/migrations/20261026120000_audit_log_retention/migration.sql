-- 20261026120000_audit_log_retention/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --write=audit_log_retention
-- Mechanical ENABLE/FORCE plus the cmsuser_all policy per table; to_regclass keeps each ALTER safe if prisma db push drops or renames a table.
-- To regenerate: bash scripts/__generate_rls_sql.sh --write=audit_log_retention
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.audit_log_retention') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_log_retention ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.audit_log_retention FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.audit_log_retention';
    EXECUTE 'CREATE POLICY cms_actor_all ON public.audit_log_retention FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff())';
  END IF;
END $$;
