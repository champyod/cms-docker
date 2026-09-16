-- 20260912000400_rls_policies/migration.sql — row-level security policies (Section B + Helper)
-- Origin: admin-panel/prisma/sql/20260820130000_rls.sql with Section A (ENABLE/FORCE block) removed.
-- WHY Section A removed: ENABLE/FORCE ROW LEVEL SECURITY is already applied by 20260912000300_rls_enable; duplicating it would be redundant.
-- WHY: policies bind cmsuser with permissive USING(true)/WITH CHECK(true) so FORCE RLS is auditable; audit_log and submissions carry genuine guarantees via absence of policies.

-- 20260820130000_rls.sql — row-level security with owner binding
-- WHY: bind cmsuser (table owner) with FORCE so RLS is not silently bypassed; every row access must satisfy an explicit policy.
-- WHY: forward-only and idempotent — DROP POLICY IF EXISTS before CREATE, ENABLE/FORCE is re-runnable, no destructive DDL; safe to re-apply after `prisma db push` via scripts/__apply_sql.sh.
-- WHY: policies reference only cmsuser so pg_dump restore into a fresh database
--   never fails with "role does not exist" — cmsuser exists everywhere as the app owner.
--   The remaining role cms_backup has BYPASSRLS so it bypasses RLS entirely and
--   does not need a policy. Naming absent roles in CREATE POLICY would make
--   pg_restore fail.
-- WHY: guarantees that are actually enforceable here are encoded as the ABSENCE of a policy (deny by default with FORCE):
--   1) audit_log is append-only (SELECT + INSERT only, no UPDATE/DELETE for any role) — hash-chained log is tamper-evident at the DB layer, not just application code.
--   2) submissions is deletable via explicit DELETE policy — direct deletes are allowed but controlled
--      by application permission + required reason + audit log (see below).
-- Exemptions (documented explicitly because they cannot carry RLS):
--   - pg_largeobject payloads cannot carry RLS — PostgreSQL does not support policies on large objects. Only metadata rows in fsobjects are gated; file access stays guarded by application-level digest handling (src/cms/db/filecacher.py, admin-panel/src/lib/fsobjects.ts).
--   - Contestant-facing row ownership is NOT enforceable — the contestant path has no database principal (it shares the application connection), so no per-user USING expression is possible. Do not pretend otherwise.


-- ── Helper: generic tables (all except audit_log and submissions) get permissive policies ──
-- WHY permissive USING(true)/WITH CHECK(true) for cmsuser with FORCE: auditable and keeps guarantees in (B) effective; the app has no per-user identity to key on so a tautology is the only correct policy.
-- WHY only cmsuser: the role exists in every database (fresh or restored) so CREATE POLICY never fails at restore time. cms_backup has BYPASSRLS and does not need a policy.

-- admins
DROP POLICY IF EXISTS cmsuser_all ON public.admins;
CREATE POLICY cmsuser_all ON public.admins FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- announcements
DROP POLICY IF EXISTS cmsuser_all ON public.announcements;
CREATE POLICY cmsuser_all ON public.announcements FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- attachments
DROP POLICY IF EXISTS cmsuser_all ON public.attachments;
CREATE POLICY cmsuser_all ON public.attachments FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- contests
DROP POLICY IF EXISTS cmsuser_all ON public.contests;
CREATE POLICY cmsuser_all ON public.contests FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- datasets
DROP POLICY IF EXISTS cmsuser_all ON public.datasets;
CREATE POLICY cmsuser_all ON public.datasets FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- evaluations
DROP POLICY IF EXISTS cmsuser_all ON public.evaluations;
CREATE POLICY cmsuser_all ON public.evaluations FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- executables
DROP POLICY IF EXISTS cmsuser_all ON public.executables;
CREATE POLICY cmsuser_all ON public.executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- files
DROP POLICY IF EXISTS cmsuser_all ON public.files;
CREATE POLICY cmsuser_all ON public.files FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- fsobjects
DROP POLICY IF EXISTS cmsuser_all ON public.fsobjects;
CREATE POLICY cmsuser_all ON public.fsobjects FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- managers
DROP POLICY IF EXISTS cmsuser_all ON public.managers;
CREATE POLICY cmsuser_all ON public.managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- messages
DROP POLICY IF EXISTS cmsuser_all ON public.messages;
CREATE POLICY cmsuser_all ON public.messages FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- participations
DROP POLICY IF EXISTS cmsuser_all ON public.participations;
CREATE POLICY cmsuser_all ON public.participations FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- questions
DROP POLICY IF EXISTS cmsuser_all ON public.questions;
CREATE POLICY cmsuser_all ON public.questions FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- statements
DROP POLICY IF EXISTS cmsuser_all ON public.statements;
CREATE POLICY cmsuser_all ON public.statements FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- submission_results
DROP POLICY IF EXISTS cmsuser_all ON public.submission_results;
CREATE POLICY cmsuser_all ON public.submission_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- tasks
DROP POLICY IF EXISTS cmsuser_all ON public.tasks;
CREATE POLICY cmsuser_all ON public.tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- teams
DROP POLICY IF EXISTS cmsuser_all ON public.teams;
CREATE POLICY cmsuser_all ON public.teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- testcases
DROP POLICY IF EXISTS cmsuser_all ON public.testcases;
CREATE POLICY cmsuser_all ON public.testcases FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- tokens
DROP POLICY IF EXISTS cmsuser_all ON public.tokens;
CREATE POLICY cmsuser_all ON public.tokens FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- user_test_executables
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_executables;
CREATE POLICY cmsuser_all ON public.user_test_executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- user_test_files
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_files;
CREATE POLICY cmsuser_all ON public.user_test_files FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- user_test_managers
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_managers;
CREATE POLICY cmsuser_all ON public.user_test_managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- user_test_results
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_results;
CREATE POLICY cmsuser_all ON public.user_test_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- user_tests
DROP POLICY IF EXISTS cmsuser_all ON public.user_tests;
CREATE POLICY cmsuser_all ON public.user_tests FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- monitor_targets
DROP POLICY IF EXISTS cmsuser_all ON public.monitor_targets;
CREATE POLICY cmsuser_all ON public.monitor_targets FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- users
DROP POLICY IF EXISTS cmsuser_all ON public.users;
CREATE POLICY cmsuser_all ON public.users FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- permissions
DROP POLICY IF EXISTS cmsuser_all ON public.permissions;
CREATE POLICY cmsuser_all ON public.permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- groups
DROP POLICY IF EXISTS cmsuser_all ON public.groups;
CREATE POLICY cmsuser_all ON public.groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- group_permissions
DROP POLICY IF EXISTS cmsuser_all ON public.group_permissions;
CREATE POLICY cmsuser_all ON public.group_permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- admin_groups
DROP POLICY IF EXISTS cmsuser_all ON public.admin_groups;
CREATE POLICY cmsuser_all ON public.admin_groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- admin_permission_overrides
DROP POLICY IF EXISTS cmsuser_all ON public.admin_permission_overrides;
CREATE POLICY cmsuser_all ON public.admin_permission_overrides FOR ALL TO cmsuser USING (true) WITH CHECK (true);

-- ── B. Genuine guarantees ─────────────────────────────────────────────────

-- B1. audit_log — append-only, no UPDATE/DELETE for any role (absence of policy denies with FORCE)
-- WHY no UPDATE/DELETE: hash-chained log must be tamper-evident at DB layer; any mutation would break chain verification.
DROP POLICY IF EXISTS cmsuser_select ON public.audit_log;
CREATE POLICY cmsuser_select ON public.audit_log FOR SELECT TO cmsuser USING (true);
DROP POLICY IF EXISTS cmsuser_insert ON public.audit_log;
CREATE POLICY cmsuser_insert ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (true);
-- WHY no cms_backup policy: it has BYPASSRLS and SELECT is sufficient for dump/restore; append-only guarantee is not bypassed for writes.
-- WHY no cms_readonly/cms_monitor policies: those roles may not exist at restore time and would make pg_restore fail; SELECT via cmsuser is the canonical path.

-- B2. submissions — deletable with permission + reason + audit logging
-- WHY DELETE is allowed: FK cascade deletes already bypass RLS (PostgreSQL does not apply row security to referential-integrity actions), so a "non-deletable" guarantee was false; deleting a contest/participation still deleted its submissions via cascade. Only direct deletes were blocked, which broke the Python admin (src/cms/db/user.py:262 declares Participation.submissions with cascade="all, delete-orphan" so SQLAlchemy issues explicit DELETEs) while Next.js Prisma (DB-level cascade) worked — an asymmetry bug. Locked decision: submissions get the full verb set; deletes are controlled by permission + a required reason + the audit log, not by absent DELETE policy.
DROP POLICY IF EXISTS cmsuser_select ON public.submissions;
CREATE POLICY cmsuser_select ON public.submissions FOR SELECT TO cmsuser USING (true);
DROP POLICY IF EXISTS cmsuser_insert ON public.submissions;
CREATE POLICY cmsuser_insert ON public.submissions FOR INSERT TO cmsuser WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_update ON public.submissions;
CREATE POLICY cmsuser_update ON public.submissions FOR UPDATE TO cmsuser USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cmsuser_delete ON public.submissions;
CREATE POLICY cmsuser_delete ON public.submissions FOR DELETE TO cmsuser USING (true);

