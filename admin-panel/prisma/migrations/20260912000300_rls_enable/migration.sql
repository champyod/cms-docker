-- 20260912000300_rls_enable/migration.sql — migrated from admin-panel/prisma/sql/20260820125500_rls_enable.sql (GENERATED)
-- Original GENERATED header preserved below.

-- 20260820125500_rls_enable.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh
-- WHY GENERATED: this block is mechanical ENABLE/FORCE per table from schema.prisma. Hand-authored policies live in 20260820130000_rls.sql.
-- WHY DO $$ with to_regclass guard: prisma db push --accept-data-loss can drop/rename a table; an unguarded ALTER TABLE would abort the entire apply (ON_ERROR_STOP=1) and leave roles half-applied.
-- To regenerate: bash scripts/__generate_rls_sql.sh
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

DO $$ BEGIN
  IF to_regclass('public.admin_groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_groups ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.admin_groups FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.admin_permission_overrides') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_permission_overrides ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.admin_permission_overrides FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.admins') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.admins FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.announcements') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.announcements FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.attachments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.contests') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contests FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.datasets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.datasets FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.evaluations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.evaluations FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.executables') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.executables ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.executables FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.files') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.files ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.files FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.fsobjects') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fsobjects ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.fsobjects FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.group_permissions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.group_permissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.group_permissions FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.groups') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.groups FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.managers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.managers FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.messages FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.monitor_targets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.monitor_targets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.monitor_targets FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.participations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.participations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.participations FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.permissions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.questions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.questions FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.statements') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.statements ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.statements FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.submission_results') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.submission_results ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.submission_results FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.submissions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.submissions FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.teams') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.teams FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.testcases') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.testcases ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.testcases FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.tokens') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tokens FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.user_test_executables') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_test_executables ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.user_test_executables FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.user_test_files') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_test_files ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.user_test_files FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.user_test_managers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_test_managers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.user_test_managers FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.user_test_results') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_test_results ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.user_test_results FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.user_tests') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.user_tests ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.user_tests FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.users FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
