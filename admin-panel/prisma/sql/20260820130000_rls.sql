-- 20260820130000_rls.sql — row-level security with owner binding
-- WHY: bind cmsuser (table owner/superuser) with FORCE so RLS is not silently bypassed; every row access must satisfy an explicit policy.
-- WHY: forward-only and idempotent — DROP POLICY IF EXISTS before CREATE, ENABLE/FORCE is re-runnable, no destructive DDL; safe to re-apply after `prisma db push` via scripts/__apply_sql.sh.
-- WHY: guarantees that are actually enforceable here are encoded as the ABSENCE of a policy (deny by default with FORCE):
--   1) audit_log is append-only (SELECT + INSERT only, no UPDATE/DELETE for any role) — hash-chained log is tamper-evident at the DB layer, not just application code.
--   2) submissions is non-deletable (SELECT/INSERT/UPDATE allowed, no DELETE for any role) — WHY UPDATE must stay: admin UI legitimately updates `comment` and `official`; WHY DELETE must not: preserve contest evidence.
-- Exemptions (documented explicitly because they cannot carry RLS):
--   - pg_largeobject payloads cannot carry RLS — PostgreSQL does not support policies on large objects. Only metadata rows in fsobjects are gated; file access stays guarded by application-level digest handling (src/cms/db/filecacher.py, admin-panel/src/lib/fsobjects.ts).
--   - Contestant-facing row ownership is NOT enforceable — the contestant path has no database principal (it shares the application connection), so no per-user USING expression is possible. Do not pretend otherwise.

-- ── A. Enable RLS everywhere, and bind the owner (FORCE) ──────────────────
-- WHY FORCE: cmsuser owns the tables and would otherwise bypass every policy; FORCE makes even the owner subject to RLS.

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datasets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.executables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executables FORCE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fsobjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fsobjects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.submission_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;
ALTER TABLE public.testcases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testcases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_executables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_executables FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_files FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_managers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_test_results FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

-- ── Helper: generic tables (all except audit_log and submissions) get permissive policies ──
-- WHY permissive USING(true)/WITH CHECK(true) for cms_service/cms_admin/cmsuser instead of BYPASSRLS: auditable and keeps guarantees in (B) effective for them too; daemons have no user identity to key on so a tautology is the only correct policy.

-- admins
DROP POLICY IF EXISTS cms_service_all ON public.admins;
CREATE POLICY cms_service_all ON public.admins FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.admins;
CREATE POLICY cms_admin_all ON public.admins FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.admins;
CREATE POLICY cmsuser_all ON public.admins FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.admins;
CREATE POLICY cms_monitor_select ON public.admins FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.admins;
CREATE POLICY cms_readonly_select ON public.admins FOR SELECT TO cms_readonly USING (true);

-- announcements
DROP POLICY IF EXISTS cms_service_all ON public.announcements;
CREATE POLICY cms_service_all ON public.announcements FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.announcements;
CREATE POLICY cms_admin_all ON public.announcements FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.announcements;
CREATE POLICY cmsuser_all ON public.announcements FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.announcements;
CREATE POLICY cms_monitor_select ON public.announcements FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.announcements;
CREATE POLICY cms_readonly_select ON public.announcements FOR SELECT TO cms_readonly USING (true);

-- attachments
DROP POLICY IF EXISTS cms_service_all ON public.attachments;
CREATE POLICY cms_service_all ON public.attachments FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.attachments;
CREATE POLICY cms_admin_all ON public.attachments FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.attachments;
CREATE POLICY cmsuser_all ON public.attachments FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.attachments;
CREATE POLICY cms_monitor_select ON public.attachments FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.attachments;
CREATE POLICY cms_readonly_select ON public.attachments FOR SELECT TO cms_readonly USING (true);

-- contests
DROP POLICY IF EXISTS cms_service_all ON public.contests;
CREATE POLICY cms_service_all ON public.contests FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.contests;
CREATE POLICY cms_admin_all ON public.contests FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.contests;
CREATE POLICY cmsuser_all ON public.contests FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.contests;
CREATE POLICY cms_monitor_select ON public.contests FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.contests;
CREATE POLICY cms_readonly_select ON public.contests FOR SELECT TO cms_readonly USING (true);

-- datasets
DROP POLICY IF EXISTS cms_service_all ON public.datasets;
CREATE POLICY cms_service_all ON public.datasets FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.datasets;
CREATE POLICY cms_admin_all ON public.datasets FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.datasets;
CREATE POLICY cmsuser_all ON public.datasets FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.datasets;
CREATE POLICY cms_monitor_select ON public.datasets FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.datasets;
CREATE POLICY cms_readonly_select ON public.datasets FOR SELECT TO cms_readonly USING (true);

-- evaluations
DROP POLICY IF EXISTS cms_service_all ON public.evaluations;
CREATE POLICY cms_service_all ON public.evaluations FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.evaluations;
CREATE POLICY cms_admin_all ON public.evaluations FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.evaluations;
CREATE POLICY cmsuser_all ON public.evaluations FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.evaluations;
CREATE POLICY cms_monitor_select ON public.evaluations FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.evaluations;
CREATE POLICY cms_readonly_select ON public.evaluations FOR SELECT TO cms_readonly USING (true);

-- executables
DROP POLICY IF EXISTS cms_service_all ON public.executables;
CREATE POLICY cms_service_all ON public.executables FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.executables;
CREATE POLICY cms_admin_all ON public.executables FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.executables;
CREATE POLICY cmsuser_all ON public.executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.executables;
CREATE POLICY cms_monitor_select ON public.executables FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.executables;
CREATE POLICY cms_readonly_select ON public.executables FOR SELECT TO cms_readonly USING (true);

-- files
DROP POLICY IF EXISTS cms_service_all ON public.files;
CREATE POLICY cms_service_all ON public.files FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.files;
CREATE POLICY cms_admin_all ON public.files FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.files;
CREATE POLICY cmsuser_all ON public.files FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.files;
CREATE POLICY cms_monitor_select ON public.files FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.files;
CREATE POLICY cms_readonly_select ON public.files FOR SELECT TO cms_readonly USING (true);

-- fsobjects
DROP POLICY IF EXISTS cms_service_all ON public.fsobjects;
CREATE POLICY cms_service_all ON public.fsobjects FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.fsobjects;
CREATE POLICY cms_admin_all ON public.fsobjects FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.fsobjects;
CREATE POLICY cmsuser_all ON public.fsobjects FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.fsobjects;
CREATE POLICY cms_monitor_select ON public.fsobjects FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.fsobjects;
CREATE POLICY cms_readonly_select ON public.fsobjects FOR SELECT TO cms_readonly USING (true);

-- managers
DROP POLICY IF EXISTS cms_service_all ON public.managers;
CREATE POLICY cms_service_all ON public.managers FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.managers;
CREATE POLICY cms_admin_all ON public.managers FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.managers;
CREATE POLICY cmsuser_all ON public.managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.managers;
CREATE POLICY cms_monitor_select ON public.managers FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.managers;
CREATE POLICY cms_readonly_select ON public.managers FOR SELECT TO cms_readonly USING (true);

-- messages
DROP POLICY IF EXISTS cms_service_all ON public.messages;
CREATE POLICY cms_service_all ON public.messages FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.messages;
CREATE POLICY cms_admin_all ON public.messages FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.messages;
CREATE POLICY cmsuser_all ON public.messages FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.messages;
CREATE POLICY cms_monitor_select ON public.messages FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.messages;
CREATE POLICY cms_readonly_select ON public.messages FOR SELECT TO cms_readonly USING (true);

-- participations
DROP POLICY IF EXISTS cms_service_all ON public.participations;
CREATE POLICY cms_service_all ON public.participations FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.participations;
CREATE POLICY cms_admin_all ON public.participations FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.participations;
CREATE POLICY cmsuser_all ON public.participations FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.participations;
CREATE POLICY cms_monitor_select ON public.participations FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.participations;
CREATE POLICY cms_readonly_select ON public.participations FOR SELECT TO cms_readonly USING (true);

-- questions
DROP POLICY IF EXISTS cms_service_all ON public.questions;
CREATE POLICY cms_service_all ON public.questions FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.questions;
CREATE POLICY cms_admin_all ON public.questions FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.questions;
CREATE POLICY cmsuser_all ON public.questions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.questions;
CREATE POLICY cms_monitor_select ON public.questions FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.questions;
CREATE POLICY cms_readonly_select ON public.questions FOR SELECT TO cms_readonly USING (true);

-- statements
DROP POLICY IF EXISTS cms_service_all ON public.statements;
CREATE POLICY cms_service_all ON public.statements FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.statements;
CREATE POLICY cms_admin_all ON public.statements FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.statements;
CREATE POLICY cmsuser_all ON public.statements FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.statements;
CREATE POLICY cms_monitor_select ON public.statements FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.statements;
CREATE POLICY cms_readonly_select ON public.statements FOR SELECT TO cms_readonly USING (true);

-- submission_results
DROP POLICY IF EXISTS cms_service_all ON public.submission_results;
CREATE POLICY cms_service_all ON public.submission_results FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.submission_results;
CREATE POLICY cms_admin_all ON public.submission_results FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.submission_results;
CREATE POLICY cmsuser_all ON public.submission_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.submission_results;
CREATE POLICY cms_monitor_select ON public.submission_results FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.submission_results;
CREATE POLICY cms_readonly_select ON public.submission_results FOR SELECT TO cms_readonly USING (true);

-- tasks
DROP POLICY IF EXISTS cms_service_all ON public.tasks;
CREATE POLICY cms_service_all ON public.tasks FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.tasks;
CREATE POLICY cms_admin_all ON public.tasks FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.tasks;
CREATE POLICY cmsuser_all ON public.tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.tasks;
CREATE POLICY cms_monitor_select ON public.tasks FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.tasks;
CREATE POLICY cms_readonly_select ON public.tasks FOR SELECT TO cms_readonly USING (true);

-- teams
DROP POLICY IF EXISTS cms_service_all ON public.teams;
CREATE POLICY cms_service_all ON public.teams FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.teams;
CREATE POLICY cms_admin_all ON public.teams FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.teams;
CREATE POLICY cmsuser_all ON public.teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.teams;
CREATE POLICY cms_monitor_select ON public.teams FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.teams;
CREATE POLICY cms_readonly_select ON public.teams FOR SELECT TO cms_readonly USING (true);

-- testcases
DROP POLICY IF EXISTS cms_service_all ON public.testcases;
CREATE POLICY cms_service_all ON public.testcases FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.testcases;
CREATE POLICY cms_admin_all ON public.testcases FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.testcases;
CREATE POLICY cmsuser_all ON public.testcases FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.testcases;
CREATE POLICY cms_monitor_select ON public.testcases FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.testcases;
CREATE POLICY cms_readonly_select ON public.testcases FOR SELECT TO cms_readonly USING (true);

-- tokens
DROP POLICY IF EXISTS cms_service_all ON public.tokens;
CREATE POLICY cms_service_all ON public.tokens FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.tokens;
CREATE POLICY cms_admin_all ON public.tokens FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.tokens;
CREATE POLICY cmsuser_all ON public.tokens FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.tokens;
CREATE POLICY cms_monitor_select ON public.tokens FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.tokens;
CREATE POLICY cms_readonly_select ON public.tokens FOR SELECT TO cms_readonly USING (true);

-- user_test_executables
DROP POLICY IF EXISTS cms_service_all ON public.user_test_executables;
CREATE POLICY cms_service_all ON public.user_test_executables FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.user_test_executables;
CREATE POLICY cms_admin_all ON public.user_test_executables FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_executables;
CREATE POLICY cmsuser_all ON public.user_test_executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.user_test_executables;
CREATE POLICY cms_monitor_select ON public.user_test_executables FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.user_test_executables;
CREATE POLICY cms_readonly_select ON public.user_test_executables FOR SELECT TO cms_readonly USING (true);

-- user_test_files
DROP POLICY IF EXISTS cms_service_all ON public.user_test_files;
CREATE POLICY cms_service_all ON public.user_test_files FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.user_test_files;
CREATE POLICY cms_admin_all ON public.user_test_files FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_files;
CREATE POLICY cmsuser_all ON public.user_test_files FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.user_test_files;
CREATE POLICY cms_monitor_select ON public.user_test_files FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.user_test_files;
CREATE POLICY cms_readonly_select ON public.user_test_files FOR SELECT TO cms_readonly USING (true);

-- user_test_managers
DROP POLICY IF EXISTS cms_service_all ON public.user_test_managers;
CREATE POLICY cms_service_all ON public.user_test_managers FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.user_test_managers;
CREATE POLICY cms_admin_all ON public.user_test_managers FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_managers;
CREATE POLICY cmsuser_all ON public.user_test_managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.user_test_managers;
CREATE POLICY cms_monitor_select ON public.user_test_managers FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.user_test_managers;
CREATE POLICY cms_readonly_select ON public.user_test_managers FOR SELECT TO cms_readonly USING (true);

-- user_test_results
DROP POLICY IF EXISTS cms_service_all ON public.user_test_results;
CREATE POLICY cms_service_all ON public.user_test_results FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.user_test_results;
CREATE POLICY cms_admin_all ON public.user_test_results FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_results;
CREATE POLICY cmsuser_all ON public.user_test_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.user_test_results;
CREATE POLICY cms_monitor_select ON public.user_test_results FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.user_test_results;
CREATE POLICY cms_readonly_select ON public.user_test_results FOR SELECT TO cms_readonly USING (true);

-- user_tests
DROP POLICY IF EXISTS cms_service_all ON public.user_tests;
CREATE POLICY cms_service_all ON public.user_tests FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.user_tests;
CREATE POLICY cms_admin_all ON public.user_tests FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.user_tests;
CREATE POLICY cmsuser_all ON public.user_tests FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.user_tests;
CREATE POLICY cms_monitor_select ON public.user_tests FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.user_tests;
CREATE POLICY cms_readonly_select ON public.user_tests FOR SELECT TO cms_readonly USING (true);

-- monitor_targets
DROP POLICY IF EXISTS cms_service_all ON public.monitor_targets;
CREATE POLICY cms_service_all ON public.monitor_targets FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.monitor_targets;
CREATE POLICY cms_admin_all ON public.monitor_targets FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.monitor_targets;
CREATE POLICY cmsuser_all ON public.monitor_targets FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.monitor_targets;
CREATE POLICY cms_monitor_select ON public.monitor_targets FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.monitor_targets;
CREATE POLICY cms_readonly_select ON public.monitor_targets FOR SELECT TO cms_readonly USING (true);

-- users
DROP POLICY IF EXISTS cms_service_all ON public.users;
CREATE POLICY cms_service_all ON public.users FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.users;
CREATE POLICY cms_admin_all ON public.users FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.users;
CREATE POLICY cmsuser_all ON public.users FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.users;
CREATE POLICY cms_monitor_select ON public.users FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.users;
CREATE POLICY cms_readonly_select ON public.users FOR SELECT TO cms_readonly USING (true);

-- permissions
DROP POLICY IF EXISTS cms_service_all ON public.permissions;
CREATE POLICY cms_service_all ON public.permissions FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.permissions;
CREATE POLICY cms_admin_all ON public.permissions FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.permissions;
CREATE POLICY cmsuser_all ON public.permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.permissions;
CREATE POLICY cms_monitor_select ON public.permissions FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.permissions;
CREATE POLICY cms_readonly_select ON public.permissions FOR SELECT TO cms_readonly USING (true);

-- groups
DROP POLICY IF EXISTS cms_service_all ON public.groups;
CREATE POLICY cms_service_all ON public.groups FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.groups;
CREATE POLICY cms_admin_all ON public.groups FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.groups;
CREATE POLICY cmsuser_all ON public.groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.groups;
CREATE POLICY cms_monitor_select ON public.groups FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.groups;
CREATE POLICY cms_readonly_select ON public.groups FOR SELECT TO cms_readonly USING (true);

-- group_permissions
DROP POLICY IF EXISTS cms_service_all ON public.group_permissions;
CREATE POLICY cms_service_all ON public.group_permissions FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.group_permissions;
CREATE POLICY cms_admin_all ON public.group_permissions FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.group_permissions;
CREATE POLICY cmsuser_all ON public.group_permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.group_permissions;
CREATE POLICY cms_monitor_select ON public.group_permissions FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.group_permissions;
CREATE POLICY cms_readonly_select ON public.group_permissions FOR SELECT TO cms_readonly USING (true);

-- admin_groups
DROP POLICY IF EXISTS cms_service_all ON public.admin_groups;
CREATE POLICY cms_service_all ON public.admin_groups FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.admin_groups;
CREATE POLICY cms_admin_all ON public.admin_groups FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.admin_groups;
CREATE POLICY cmsuser_all ON public.admin_groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.admin_groups;
CREATE POLICY cms_monitor_select ON public.admin_groups FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.admin_groups;
CREATE POLICY cms_readonly_select ON public.admin_groups FOR SELECT TO cms_readonly USING (true);

-- admin_permission_overrides
DROP POLICY IF EXISTS cms_service_all ON public.admin_permission_overrides;
CREATE POLICY cms_service_all ON public.admin_permission_overrides FOR ALL TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_all ON public.admin_permission_overrides;
CREATE POLICY cms_admin_all ON public.admin_permission_overrides FOR ALL TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_all ON public.admin_permission_overrides;
CREATE POLICY cmsuser_all ON public.admin_permission_overrides FOR ALL TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.admin_permission_overrides;
CREATE POLICY cms_monitor_select ON public.admin_permission_overrides FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.admin_permission_overrides;
CREATE POLICY cms_readonly_select ON public.admin_permission_overrides FOR SELECT TO cms_readonly USING (true);

-- ── B. Genuine guarantees ─────────────────────────────────────────────────

-- B1. audit_log — append-only, no UPDATE/DELETE for any role (absence of policy denies with FORCE)
-- WHY no UPDATE/DELETE: hash-chained log must be tamper-evident at DB layer; any mutation would break chain verification.
DROP POLICY IF EXISTS cms_service_select ON public.audit_log;
CREATE POLICY cms_service_select ON public.audit_log FOR SELECT TO cms_service USING (true);
DROP POLICY IF EXISTS cms_service_insert ON public.audit_log;
CREATE POLICY cms_service_insert ON public.audit_log FOR INSERT TO cms_service WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_select ON public.audit_log;
CREATE POLICY cms_admin_select ON public.audit_log FOR SELECT TO cms_admin USING (true);
DROP POLICY IF EXISTS cms_admin_insert ON public.audit_log;
CREATE POLICY cms_admin_insert ON public.audit_log FOR INSERT TO cms_admin WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_select ON public.audit_log;
CREATE POLICY cmsuser_select ON public.audit_log FOR SELECT TO cmsuser USING (true);
DROP POLICY IF EXISTS cmsuser_insert ON public.audit_log;
CREATE POLICY cmsuser_insert ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.audit_log;
CREATE POLICY cms_monitor_select ON public.audit_log FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.audit_log;
CREATE POLICY cms_readonly_select ON public.audit_log FOR SELECT TO cms_readonly USING (true);

-- B2. submissions — non-deletable, but updatable
-- WHY UPDATE allowed while DELETE denied: admin UI legitimately updates `comment`/`official`; deletion would destroy contest evidence and must be denied at DB layer.
DROP POLICY IF EXISTS cms_service_select ON public.submissions;
CREATE POLICY cms_service_select ON public.submissions FOR SELECT TO cms_service USING (true);
DROP POLICY IF EXISTS cms_service_insert ON public.submissions;
CREATE POLICY cms_service_insert ON public.submissions FOR INSERT TO cms_service WITH CHECK (true);
DROP POLICY IF EXISTS cms_service_update ON public.submissions;
CREATE POLICY cms_service_update ON public.submissions FOR UPDATE TO cms_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_select ON public.submissions;
CREATE POLICY cms_admin_select ON public.submissions FOR SELECT TO cms_admin USING (true);
DROP POLICY IF EXISTS cms_admin_insert ON public.submissions;
CREATE POLICY cms_admin_insert ON public.submissions FOR INSERT TO cms_admin WITH CHECK (true);
DROP POLICY IF EXISTS cms_admin_update ON public.submissions;
CREATE POLICY cms_admin_update ON public.submissions FOR UPDATE TO cms_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_select ON public.submissions;
CREATE POLICY cmsuser_select ON public.submissions FOR SELECT TO cmsuser USING (true);
DROP POLICY IF EXISTS cmsuser_insert ON public.submissions;
CREATE POLICY cmsuser_insert ON public.submissions FOR INSERT TO cmsuser WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_update ON public.submissions;
CREATE POLICY cmsuser_update ON public.submissions FOR UPDATE TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cms_monitor_select ON public.submissions;
CREATE POLICY cms_monitor_select ON public.submissions FOR SELECT TO cms_monitor USING (true);
DROP POLICY IF EXISTS cms_readonly_select ON public.submissions;
CREATE POLICY cms_readonly_select ON public.submissions FOR SELECT TO cms_readonly USING (true);
