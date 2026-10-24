-- 20261025120000_rls_actor_policies/migration.sql — RLS stops being a tautology
--
-- WHAT: every table's policy is replaced. `USING (true) WITH CHECK (true)` becomes a predicate over
-- `cms.actor`, a transaction-local GUC the application sets with set_config(..., is_local => true)
-- inside the transaction that runs its queries. 43 of 59 tables require an identified actor for
-- EVERY verb; 16 keep SELECT open because the anonymous public board reads them over the same
-- cmsuser connection, but every WRITE to those is gated. `audit_log` additionally refuses a row
-- that attributes a write to an admin other than the acting one. The per-table rule is not authored
-- here: this block is the rendering of `scripts/__generate_rls_sql.sh --emit-policies`, and
-- `make lint` diffs it against a fresh rendering.
--
-- WHY THIS IS SAFE TO APPLY AT ALL: the acting role is `cmsuser` (the panel, the Python core and
-- ranking-web all receive the same DATABASE_URL), and cmsuser is NOSUPERUSER + NOBYPASSRLS with
-- FORCE ROW LEVEL SECURITY on every table (20260912000500_owner_hardening), so RLS applies to it.
-- Only cms_backup bypasses, by BYPASSRLS, for pg_dump. Nothing here changes any role.
--
-- ⚠ ROLLOUT — DO NOT APPLY THIS MIGRATION TO A LIVE CONTEST WITHOUT THE ACTOR-SETTING CODE IN THE
-- SAME RELEASE. Enforcement and identity ship together or not at all:
--   · admin-panel  src/lib/db-actor.ts (withActor / the session-derived actor) + src/lib/prisma.ts
--   · cms core     src/cms/db/actor.py + the after_begin hook in src/cms/db/session.py
-- The moment the policies are in place, any query path that has not set `cms.actor` reads ZERO
-- rows and cannot write at all — by design, because the previous behaviour was "reads everything".
-- That is a silent, total outage of that path, not an error, so a partially-deployed release looks
-- like an empty database. Deploy order therefore is: code first (it is a no-op while the policies
-- are permissive), migration second, in one release window. Reverting is a single follow-up
-- migration; the exact pre-change bodies are in the REVERSAL block at the end of this file.
--   Known uncovered path at authoring time: ranking-web (src/store*.rs) sets no actor. It survives
--   because its whole read set is in the public-board list below; it writes only
--   admins.last_login_at, which is also carved out. Any NEW statement it gains against any other
--   table will silently return nothing until it sets `cms.actor`.
--
-- WHY NOT hand-written: the repo rule is that policies come from the generator, never authored
-- twice. A table missing from the classification gets the strict policy, so a new model is
-- enforced by default and cannot be added permissive.
--
-- REVERSIBLE: this file only DROP POLICY / CREATE POLICY / CREATE OR REPLACE FUNCTION. No table is
-- altered, no row is read or written, no column changes. The reversal block at the end restores
-- every previous policy body verbatim.

-- BEGIN GENERATED POLICY SET (scripts/__generate_rls_sql.sh --emit-policies) — do not hand-edit
-- ── Actor identity, read from the transaction-local GUC the application sets ───────────────
-- WHY current_setting(..., true): the missing_ok form returns NULL instead of raising when the
-- GUC is unset, so an actor-less connection reads as "no actor" (and every predicate below is
-- false) rather than erroring the whole query out. Fail closed, not fail loud, at the row level.
CREATE OR REPLACE FUNCTION public.cms_actor() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('cms.actor', true), '')
  $$;

-- Only the exact shape `admin:<decimal>` yields an id. Anything else (a malformed value, a system
-- identity) is NULL, so a forged or truncated GUC cannot name an admin.
CREATE OR REPLACE FUNCTION public.cms_actor_admin_id() RETURNS integer
  LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN public.cms_actor() ~ '^admin:[0-9]{1,9}$'
             THEN split_part(public.cms_actor(), ':', 2)::integer
           END
  $$;

-- A system identity must carry the `system:` prefix AND be named here. The prefix check is what
-- keeps `admin:7` out of the allowlist even if a name collided with it.
CREATE OR REPLACE FUNCTION public.cms_actor_any(names text[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor() LIKE 'system:%' AND public.cms_actor() = ANY(names)
  $$;

-- The trusted application identities: a signed-in panel admin, the Python core, the panel's CLI,
-- and migrations/seeding. Everything outside this set is an unidentified connection.
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration'])
  $$;

-- The same set plus the pre-session login path. Used only on AUTH_BOOTSTRAP tables.
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff_or_auth() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:auth'])
  $$;

-- admin_groups
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.admin_groups;
DROP POLICY IF EXISTS cms_public_read ON public.admin_groups;
DROP POLICY IF EXISTS cms_actor_write ON public.admin_groups;
CREATE POLICY cms_public_read ON public.admin_groups FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.admin_groups FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- admin_permission_overrides
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.admin_permission_overrides;
DROP POLICY IF EXISTS cms_public_read ON public.admin_permission_overrides;
DROP POLICY IF EXISTS cms_actor_write ON public.admin_permission_overrides;
CREATE POLICY cms_public_read ON public.admin_permission_overrides FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.admin_permission_overrides FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- admins
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.admins;
DROP POLICY IF EXISTS cms_public_read ON public.admins;
DROP POLICY IF EXISTS cms_actor_write ON public.admins;
CREATE POLICY cms_public_read ON public.admins FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.admins FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());
-- CONSOLE_LOGIN_UPDATE: the ranking console stamps last_login_at with no identity; only UPDATE is open.
DROP POLICY IF EXISTS cms_public_update ON public.admins;
CREATE POLICY cms_public_update ON public.admins FOR UPDATE TO cmsuser USING (true) WITH CHECK (true);

-- announcements
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.announcements;
DROP POLICY IF EXISTS cmsuser_select ON public.announcements;
DROP POLICY IF EXISTS cmsuser_insert ON public.announcements;
DROP POLICY IF EXISTS cmsuser_update ON public.announcements;
DROP POLICY IF EXISTS cmsuser_delete ON public.announcements;
DROP POLICY IF EXISTS cms_actor_all ON public.announcements;
CREATE POLICY cms_actor_all ON public.announcements FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- attachments
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.attachments;
DROP POLICY IF EXISTS cmsuser_select ON public.attachments;
DROP POLICY IF EXISTS cmsuser_insert ON public.attachments;
DROP POLICY IF EXISTS cmsuser_update ON public.attachments;
DROP POLICY IF EXISTS cmsuser_delete ON public.attachments;
DROP POLICY IF EXISTS cms_actor_all ON public.attachments;
CREATE POLICY cms_actor_all ON public.attachments FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- audit_log
-- AUDIT_LOG: append-only by ABSENCE of UPDATE/DELETE, and no admin may forge an attribution: an
-- admin actor can only file a row under itself (or under nobody); only a system identity names another.
DROP POLICY IF EXISTS cmsuser_all ON public.audit_log;
DROP POLICY IF EXISTS cmsuser_select ON public.audit_log;
DROP POLICY IF EXISTS cmsuser_insert ON public.audit_log;
DROP POLICY IF EXISTS cms_actor_read ON public.audit_log;
DROP POLICY IF EXISTS cms_actor_append ON public.audit_log;
CREATE POLICY cms_actor_read ON public.audit_log FOR SELECT TO cmsuser USING (public.cms_actor_is_staff());
CREATE POLICY cms_actor_append ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (
  public.cms_actor_is_staff()
  AND (
    public.cms_actor_admin_id() IS NULL
    OR actor_id IS NULL
    OR actor_id = public.cms_actor_admin_id()
  )
);

-- backup_runs
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.backup_runs;
DROP POLICY IF EXISTS cmsuser_select ON public.backup_runs;
DROP POLICY IF EXISTS cmsuser_insert ON public.backup_runs;
DROP POLICY IF EXISTS cmsuser_update ON public.backup_runs;
DROP POLICY IF EXISTS cmsuser_delete ON public.backup_runs;
DROP POLICY IF EXISTS cms_actor_all ON public.backup_runs;
CREATE POLICY cms_actor_all ON public.backup_runs FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- backup_schedules
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.backup_schedules;
DROP POLICY IF EXISTS cmsuser_select ON public.backup_schedules;
DROP POLICY IF EXISTS cmsuser_insert ON public.backup_schedules;
DROP POLICY IF EXISTS cmsuser_update ON public.backup_schedules;
DROP POLICY IF EXISTS cmsuser_delete ON public.backup_schedules;
DROP POLICY IF EXISTS cms_actor_all ON public.backup_schedules;
CREATE POLICY cms_actor_all ON public.backup_schedules FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contest_exposures
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contest_exposures;
DROP POLICY IF EXISTS cmsuser_select ON public.contest_exposures;
DROP POLICY IF EXISTS cmsuser_insert ON public.contest_exposures;
DROP POLICY IF EXISTS cmsuser_update ON public.contest_exposures;
DROP POLICY IF EXISTS cmsuser_delete ON public.contest_exposures;
DROP POLICY IF EXISTS cms_actor_all ON public.contest_exposures;
CREATE POLICY cms_actor_all ON public.contest_exposures FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contest_tasks
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contest_tasks;
DROP POLICY IF EXISTS cmsuser_select ON public.contest_tasks;
DROP POLICY IF EXISTS cmsuser_insert ON public.contest_tasks;
DROP POLICY IF EXISTS cmsuser_update ON public.contest_tasks;
DROP POLICY IF EXISTS cmsuser_delete ON public.contest_tasks;
DROP POLICY IF EXISTS cms_actor_all ON public.contest_tasks;
CREATE POLICY cms_actor_all ON public.contest_tasks FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contest_teams
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contest_teams;
DROP POLICY IF EXISTS cmsuser_select ON public.contest_teams;
DROP POLICY IF EXISTS cmsuser_insert ON public.contest_teams;
DROP POLICY IF EXISTS cmsuser_update ON public.contest_teams;
DROP POLICY IF EXISTS cmsuser_delete ON public.contest_teams;
DROP POLICY IF EXISTS cms_actor_all ON public.contest_teams;
CREATE POLICY cms_actor_all ON public.contest_teams FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contest_usernames
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contest_usernames;
DROP POLICY IF EXISTS cmsuser_select ON public.contest_usernames;
DROP POLICY IF EXISTS cmsuser_insert ON public.contest_usernames;
DROP POLICY IF EXISTS cmsuser_update ON public.contest_usernames;
DROP POLICY IF EXISTS cmsuser_delete ON public.contest_usernames;
DROP POLICY IF EXISTS cms_actor_all ON public.contest_usernames;
CREATE POLICY cms_actor_all ON public.contest_usernames FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contest_usernames_history
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contest_usernames_history;
DROP POLICY IF EXISTS cmsuser_select ON public.contest_usernames_history;
DROP POLICY IF EXISTS cmsuser_insert ON public.contest_usernames_history;
DROP POLICY IF EXISTS cmsuser_update ON public.contest_usernames_history;
DROP POLICY IF EXISTS cmsuser_delete ON public.contest_usernames_history;
DROP POLICY IF EXISTS cms_actor_all ON public.contest_usernames_history;
CREATE POLICY cms_actor_all ON public.contest_usernames_history FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contestant_group_memberships
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contestant_group_memberships;
DROP POLICY IF EXISTS cmsuser_select ON public.contestant_group_memberships;
DROP POLICY IF EXISTS cmsuser_insert ON public.contestant_group_memberships;
DROP POLICY IF EXISTS cmsuser_update ON public.contestant_group_memberships;
DROP POLICY IF EXISTS cmsuser_delete ON public.contestant_group_memberships;
DROP POLICY IF EXISTS cms_actor_all ON public.contestant_group_memberships;
CREATE POLICY cms_actor_all ON public.contestant_group_memberships FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contestant_groups
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contestant_groups;
DROP POLICY IF EXISTS cmsuser_select ON public.contestant_groups;
DROP POLICY IF EXISTS cmsuser_insert ON public.contestant_groups;
DROP POLICY IF EXISTS cmsuser_update ON public.contestant_groups;
DROP POLICY IF EXISTS cmsuser_delete ON public.contestant_groups;
DROP POLICY IF EXISTS cms_actor_all ON public.contestant_groups;
CREATE POLICY cms_actor_all ON public.contestant_groups FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- contests
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.contests;
DROP POLICY IF EXISTS cmsuser_select ON public.contests;
DROP POLICY IF EXISTS cmsuser_insert ON public.contests;
DROP POLICY IF EXISTS cmsuser_update ON public.contests;
DROP POLICY IF EXISTS cmsuser_delete ON public.contests;
DROP POLICY IF EXISTS cms_actor_all ON public.contests;
CREATE POLICY cms_actor_all ON public.contests FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- datasets
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.datasets;
DROP POLICY IF EXISTS cmsuser_select ON public.datasets;
DROP POLICY IF EXISTS cmsuser_insert ON public.datasets;
DROP POLICY IF EXISTS cmsuser_update ON public.datasets;
DROP POLICY IF EXISTS cmsuser_delete ON public.datasets;
DROP POLICY IF EXISTS cms_actor_all ON public.datasets;
CREATE POLICY cms_actor_all ON public.datasets FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- evaluations
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.evaluations;
DROP POLICY IF EXISTS cmsuser_select ON public.evaluations;
DROP POLICY IF EXISTS cmsuser_insert ON public.evaluations;
DROP POLICY IF EXISTS cmsuser_update ON public.evaluations;
DROP POLICY IF EXISTS cmsuser_delete ON public.evaluations;
DROP POLICY IF EXISTS cms_actor_all ON public.evaluations;
CREATE POLICY cms_actor_all ON public.evaluations FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- executables
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.executables;
DROP POLICY IF EXISTS cmsuser_select ON public.executables;
DROP POLICY IF EXISTS cmsuser_insert ON public.executables;
DROP POLICY IF EXISTS cmsuser_update ON public.executables;
DROP POLICY IF EXISTS cmsuser_delete ON public.executables;
DROP POLICY IF EXISTS cms_actor_all ON public.executables;
CREATE POLICY cms_actor_all ON public.executables FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- files
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.files;
DROP POLICY IF EXISTS cmsuser_select ON public.files;
DROP POLICY IF EXISTS cmsuser_insert ON public.files;
DROP POLICY IF EXISTS cmsuser_update ON public.files;
DROP POLICY IF EXISTS cmsuser_delete ON public.files;
DROP POLICY IF EXISTS cms_actor_all ON public.files;
CREATE POLICY cms_actor_all ON public.files FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- fsobjects
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.fsobjects;
DROP POLICY IF EXISTS cmsuser_select ON public.fsobjects;
DROP POLICY IF EXISTS cmsuser_insert ON public.fsobjects;
DROP POLICY IF EXISTS cmsuser_update ON public.fsobjects;
DROP POLICY IF EXISTS cmsuser_delete ON public.fsobjects;
DROP POLICY IF EXISTS cms_actor_all ON public.fsobjects;
CREATE POLICY cms_actor_all ON public.fsobjects FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- group_permissions
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.group_permissions;
DROP POLICY IF EXISTS cms_public_read ON public.group_permissions;
DROP POLICY IF EXISTS cms_actor_write ON public.group_permissions;
CREATE POLICY cms_public_read ON public.group_permissions FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.group_permissions FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- groups
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.groups;
DROP POLICY IF EXISTS cmsuser_select ON public.groups;
DROP POLICY IF EXISTS cmsuser_insert ON public.groups;
DROP POLICY IF EXISTS cmsuser_update ON public.groups;
DROP POLICY IF EXISTS cmsuser_delete ON public.groups;
DROP POLICY IF EXISTS cms_actor_all ON public.groups;
CREATE POLICY cms_actor_all ON public.groups FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- login_surfaces
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.login_surfaces;
DROP POLICY IF EXISTS cmsuser_select ON public.login_surfaces;
DROP POLICY IF EXISTS cmsuser_insert ON public.login_surfaces;
DROP POLICY IF EXISTS cmsuser_update ON public.login_surfaces;
DROP POLICY IF EXISTS cmsuser_delete ON public.login_surfaces;
DROP POLICY IF EXISTS cms_actor_all ON public.login_surfaces;
CREATE POLICY cms_actor_all ON public.login_surfaces FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- managers
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.managers;
DROP POLICY IF EXISTS cmsuser_select ON public.managers;
DROP POLICY IF EXISTS cmsuser_insert ON public.managers;
DROP POLICY IF EXISTS cmsuser_update ON public.managers;
DROP POLICY IF EXISTS cmsuser_delete ON public.managers;
DROP POLICY IF EXISTS cms_actor_all ON public.managers;
CREATE POLICY cms_actor_all ON public.managers FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- messages
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.messages;
DROP POLICY IF EXISTS cmsuser_select ON public.messages;
DROP POLICY IF EXISTS cmsuser_insert ON public.messages;
DROP POLICY IF EXISTS cmsuser_update ON public.messages;
DROP POLICY IF EXISTS cmsuser_delete ON public.messages;
DROP POLICY IF EXISTS cms_actor_all ON public.messages;
CREATE POLICY cms_actor_all ON public.messages FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- monitor_targets
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.monitor_targets;
DROP POLICY IF EXISTS cmsuser_select ON public.monitor_targets;
DROP POLICY IF EXISTS cmsuser_insert ON public.monitor_targets;
DROP POLICY IF EXISTS cmsuser_update ON public.monitor_targets;
DROP POLICY IF EXISTS cmsuser_delete ON public.monitor_targets;
DROP POLICY IF EXISTS cms_actor_all ON public.monitor_targets;
CREATE POLICY cms_actor_all ON public.monitor_targets FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- participations
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.participations;
DROP POLICY IF EXISTS cmsuser_select ON public.participations;
DROP POLICY IF EXISTS cmsuser_insert ON public.participations;
DROP POLICY IF EXISTS cmsuser_update ON public.participations;
DROP POLICY IF EXISTS cmsuser_delete ON public.participations;
DROP POLICY IF EXISTS cms_actor_all ON public.participations;
CREATE POLICY cms_actor_all ON public.participations FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- permissions
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.permissions;
DROP POLICY IF EXISTS cms_public_read ON public.permissions;
DROP POLICY IF EXISTS cms_actor_write ON public.permissions;
CREATE POLICY cms_public_read ON public.permissions FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.permissions FOR ALL TO cmsuser USING (public.cms_actor_is_staff_or_auth()) WITH CHECK (public.cms_actor_is_staff_or_auth());

-- questions
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.questions;
DROP POLICY IF EXISTS cmsuser_select ON public.questions;
DROP POLICY IF EXISTS cmsuser_insert ON public.questions;
DROP POLICY IF EXISTS cmsuser_update ON public.questions;
DROP POLICY IF EXISTS cmsuser_delete ON public.questions;
DROP POLICY IF EXISTS cms_actor_all ON public.questions;
CREATE POLICY cms_actor_all ON public.questions FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_config
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_config;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_config;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_config;
CREATE POLICY cms_public_read ON public.ranking_config FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_config FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_contests
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_contests;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_contests;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_contests;
CREATE POLICY cms_public_read ON public.ranking_contests FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_contests FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_hidden
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_hidden;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_hidden;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_hidden;
CREATE POLICY cms_public_read ON public.ranking_hidden FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_hidden FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_overrides
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_overrides;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_overrides;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_overrides;
CREATE POLICY cms_public_read ON public.ranking_overrides FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_overrides FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_settings
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_settings;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_settings;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_settings;
CREATE POLICY cms_public_read ON public.ranking_settings FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_settings FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_subchanges
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_subchanges;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_subchanges;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_subchanges;
CREATE POLICY cms_public_read ON public.ranking_subchanges FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_subchanges FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_submissions
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_submissions;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_submissions;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_submissions;
CREATE POLICY cms_public_read ON public.ranking_submissions FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_submissions FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_tasks
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_tasks;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_tasks;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_tasks;
CREATE POLICY cms_public_read ON public.ranking_tasks FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_tasks FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_teams
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_teams;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_teams;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_teams;
CREATE POLICY cms_public_read ON public.ranking_teams FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_teams FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- ranking_users
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.ranking_users;
DROP POLICY IF EXISTS cms_public_read ON public.ranking_users;
DROP POLICY IF EXISTS cms_actor_write ON public.ranking_users;
CREATE POLICY cms_public_read ON public.ranking_users FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.ranking_users FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- security_blocks
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.security_blocks;
DROP POLICY IF EXISTS cmsuser_select ON public.security_blocks;
DROP POLICY IF EXISTS cmsuser_insert ON public.security_blocks;
DROP POLICY IF EXISTS cmsuser_update ON public.security_blocks;
DROP POLICY IF EXISTS cmsuser_delete ON public.security_blocks;
DROP POLICY IF EXISTS cms_actor_all ON public.security_blocks;
CREATE POLICY cms_actor_all ON public.security_blocks FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- security_findings
-- INGEST_WRITE: readable by staff, appended and updated by the security-feed container too.
DROP POLICY IF EXISTS cmsuser_all ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_read ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_append ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_update ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_delete ON public.security_findings;
CREATE POLICY cms_actor_read ON public.security_findings FOR SELECT TO cmsuser USING (public.cms_actor_is_staff());
CREATE POLICY cms_actor_append ON public.security_findings FOR INSERT TO cmsuser WITH CHECK (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest']));
CREATE POLICY cms_actor_update ON public.security_findings FOR UPDATE TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest'])) WITH CHECK (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest']));
CREATE POLICY cms_actor_delete ON public.security_findings FOR DELETE TO cmsuser USING (public.cms_actor_is_staff());

-- security_waivers
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.security_waivers;
DROP POLICY IF EXISTS cmsuser_select ON public.security_waivers;
DROP POLICY IF EXISTS cmsuser_insert ON public.security_waivers;
DROP POLICY IF EXISTS cmsuser_update ON public.security_waivers;
DROP POLICY IF EXISTS cmsuser_delete ON public.security_waivers;
DROP POLICY IF EXISTS cms_actor_all ON public.security_waivers;
CREATE POLICY cms_actor_all ON public.security_waivers FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- services
-- PUBLIC_BOARD_READ: SELECT carries no actor because the anonymous public board reads it; writes do.
DROP POLICY IF EXISTS cmsuser_all ON public.services;
DROP POLICY IF EXISTS cms_public_read ON public.services;
DROP POLICY IF EXISTS cms_actor_write ON public.services;
CREATE POLICY cms_public_read ON public.services FOR SELECT TO cmsuser USING (true);
CREATE POLICY cms_actor_write ON public.services FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- statements
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.statements;
DROP POLICY IF EXISTS cmsuser_select ON public.statements;
DROP POLICY IF EXISTS cmsuser_insert ON public.statements;
DROP POLICY IF EXISTS cmsuser_update ON public.statements;
DROP POLICY IF EXISTS cmsuser_delete ON public.statements;
DROP POLICY IF EXISTS cms_actor_all ON public.statements;
CREATE POLICY cms_actor_all ON public.statements FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- submission_results
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.submission_results;
DROP POLICY IF EXISTS cmsuser_select ON public.submission_results;
DROP POLICY IF EXISTS cmsuser_insert ON public.submission_results;
DROP POLICY IF EXISTS cmsuser_update ON public.submission_results;
DROP POLICY IF EXISTS cmsuser_delete ON public.submission_results;
DROP POLICY IF EXISTS cms_actor_all ON public.submission_results;
CREATE POLICY cms_actor_all ON public.submission_results FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- submissions
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.submissions;
DROP POLICY IF EXISTS cmsuser_select ON public.submissions;
DROP POLICY IF EXISTS cmsuser_insert ON public.submissions;
DROP POLICY IF EXISTS cmsuser_update ON public.submissions;
DROP POLICY IF EXISTS cmsuser_delete ON public.submissions;
DROP POLICY IF EXISTS cms_actor_all ON public.submissions;
CREATE POLICY cms_actor_all ON public.submissions FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- tasks
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.tasks;
DROP POLICY IF EXISTS cmsuser_select ON public.tasks;
DROP POLICY IF EXISTS cmsuser_insert ON public.tasks;
DROP POLICY IF EXISTS cmsuser_update ON public.tasks;
DROP POLICY IF EXISTS cmsuser_delete ON public.tasks;
DROP POLICY IF EXISTS cms_actor_all ON public.tasks;
CREATE POLICY cms_actor_all ON public.tasks FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- teams
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.teams;
DROP POLICY IF EXISTS cmsuser_select ON public.teams;
DROP POLICY IF EXISTS cmsuser_insert ON public.teams;
DROP POLICY IF EXISTS cmsuser_update ON public.teams;
DROP POLICY IF EXISTS cmsuser_delete ON public.teams;
DROP POLICY IF EXISTS cms_actor_all ON public.teams;
CREATE POLICY cms_actor_all ON public.teams FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- testcases
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.testcases;
DROP POLICY IF EXISTS cmsuser_select ON public.testcases;
DROP POLICY IF EXISTS cmsuser_insert ON public.testcases;
DROP POLICY IF EXISTS cmsuser_update ON public.testcases;
DROP POLICY IF EXISTS cmsuser_delete ON public.testcases;
DROP POLICY IF EXISTS cms_actor_all ON public.testcases;
CREATE POLICY cms_actor_all ON public.testcases FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- tokens
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.tokens;
DROP POLICY IF EXISTS cmsuser_select ON public.tokens;
DROP POLICY IF EXISTS cmsuser_insert ON public.tokens;
DROP POLICY IF EXISTS cmsuser_update ON public.tokens;
DROP POLICY IF EXISTS cmsuser_delete ON public.tokens;
DROP POLICY IF EXISTS cms_actor_all ON public.tokens;
CREATE POLICY cms_actor_all ON public.tokens FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- user_test_executables
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_executables;
DROP POLICY IF EXISTS cmsuser_select ON public.user_test_executables;
DROP POLICY IF EXISTS cmsuser_insert ON public.user_test_executables;
DROP POLICY IF EXISTS cmsuser_update ON public.user_test_executables;
DROP POLICY IF EXISTS cmsuser_delete ON public.user_test_executables;
DROP POLICY IF EXISTS cms_actor_all ON public.user_test_executables;
CREATE POLICY cms_actor_all ON public.user_test_executables FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- user_test_files
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_files;
DROP POLICY IF EXISTS cmsuser_select ON public.user_test_files;
DROP POLICY IF EXISTS cmsuser_insert ON public.user_test_files;
DROP POLICY IF EXISTS cmsuser_update ON public.user_test_files;
DROP POLICY IF EXISTS cmsuser_delete ON public.user_test_files;
DROP POLICY IF EXISTS cms_actor_all ON public.user_test_files;
CREATE POLICY cms_actor_all ON public.user_test_files FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- user_test_managers
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_managers;
DROP POLICY IF EXISTS cmsuser_select ON public.user_test_managers;
DROP POLICY IF EXISTS cmsuser_insert ON public.user_test_managers;
DROP POLICY IF EXISTS cmsuser_update ON public.user_test_managers;
DROP POLICY IF EXISTS cmsuser_delete ON public.user_test_managers;
DROP POLICY IF EXISTS cms_actor_all ON public.user_test_managers;
CREATE POLICY cms_actor_all ON public.user_test_managers FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- user_test_results
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.user_test_results;
DROP POLICY IF EXISTS cmsuser_select ON public.user_test_results;
DROP POLICY IF EXISTS cmsuser_insert ON public.user_test_results;
DROP POLICY IF EXISTS cmsuser_update ON public.user_test_results;
DROP POLICY IF EXISTS cmsuser_delete ON public.user_test_results;
DROP POLICY IF EXISTS cms_actor_all ON public.user_test_results;
CREATE POLICY cms_actor_all ON public.user_test_results FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- user_tests
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.user_tests;
DROP POLICY IF EXISTS cmsuser_select ON public.user_tests;
DROP POLICY IF EXISTS cmsuser_insert ON public.user_tests;
DROP POLICY IF EXISTS cmsuser_update ON public.user_tests;
DROP POLICY IF EXISTS cmsuser_delete ON public.user_tests;
DROP POLICY IF EXISTS cms_actor_all ON public.user_tests;
CREATE POLICY cms_actor_all ON public.user_tests FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- username_policies
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.username_policies;
DROP POLICY IF EXISTS cmsuser_select ON public.username_policies;
DROP POLICY IF EXISTS cmsuser_insert ON public.username_policies;
DROP POLICY IF EXISTS cmsuser_update ON public.username_policies;
DROP POLICY IF EXISTS cmsuser_delete ON public.username_policies;
DROP POLICY IF EXISTS cms_actor_all ON public.username_policies;
CREATE POLICY cms_actor_all ON public.username_policies FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- users
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.users;
DROP POLICY IF EXISTS cmsuser_select ON public.users;
DROP POLICY IF EXISTS cmsuser_insert ON public.users;
DROP POLICY IF EXISTS cmsuser_update ON public.users;
DROP POLICY IF EXISTS cmsuser_delete ON public.users;
DROP POLICY IF EXISTS cms_actor_all ON public.users;
CREATE POLICY cms_actor_all ON public.users FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());

-- wirings
-- STRICT: every verb requires an identified actor.
DROP POLICY IF EXISTS cmsuser_all ON public.wirings;
DROP POLICY IF EXISTS cmsuser_select ON public.wirings;
DROP POLICY IF EXISTS cmsuser_insert ON public.wirings;
DROP POLICY IF EXISTS cmsuser_update ON public.wirings;
DROP POLICY IF EXISTS cmsuser_delete ON public.wirings;
DROP POLICY IF EXISTS cms_actor_all ON public.wirings;
CREATE POLICY cms_actor_all ON public.wirings FOR ALL TO cmsuser USING (public.cms_actor_is_staff()) WITH CHECK (public.cms_actor_is_staff());
-- END GENERATED POLICY SET


-- ══ REVERSAL (commented out — this file is forward-only; copy it into a new migration to undo) ══
-- Restores the pre-change state exactly: the permissive cmsuser_all on every table, the
-- audit_log SELECT+INSERT pair, and the four submissions verbs. Nothing else changes.
-- DROP POLICY IF EXISTS cms_actor_all ON public.admin_groups;
-- DROP POLICY IF EXISTS cms_public_read ON public.admin_groups;
-- DROP POLICY IF EXISTS cms_actor_write ON public.admin_groups;
-- DROP POLICY IF EXISTS cms_public_update ON public.admin_groups;
-- CREATE POLICY cmsuser_all ON public.admin_groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.admin_permission_overrides;
-- DROP POLICY IF EXISTS cms_public_read ON public.admin_permission_overrides;
-- DROP POLICY IF EXISTS cms_actor_write ON public.admin_permission_overrides;
-- DROP POLICY IF EXISTS cms_public_update ON public.admin_permission_overrides;
-- CREATE POLICY cmsuser_all ON public.admin_permission_overrides FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.admins;
-- DROP POLICY IF EXISTS cms_public_read ON public.admins;
-- DROP POLICY IF EXISTS cms_actor_write ON public.admins;
-- DROP POLICY IF EXISTS cms_public_update ON public.admins;
-- CREATE POLICY cmsuser_all ON public.admins FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.announcements;
-- DROP POLICY IF EXISTS cms_public_read ON public.announcements;
-- DROP POLICY IF EXISTS cms_actor_write ON public.announcements;
-- DROP POLICY IF EXISTS cms_public_update ON public.announcements;
-- CREATE POLICY cmsuser_all ON public.announcements FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.attachments;
-- DROP POLICY IF EXISTS cms_public_read ON public.attachments;
-- DROP POLICY IF EXISTS cms_actor_write ON public.attachments;
-- DROP POLICY IF EXISTS cms_public_update ON public.attachments;
-- CREATE POLICY cmsuser_all ON public.attachments FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_read ON public.audit_log;
-- DROP POLICY IF EXISTS cms_actor_append ON public.audit_log;
-- CREATE POLICY cmsuser_select ON public.audit_log FOR SELECT TO cmsuser USING (true);
-- CREATE POLICY cmsuser_insert ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.backup_runs;
-- DROP POLICY IF EXISTS cms_public_read ON public.backup_runs;
-- DROP POLICY IF EXISTS cms_actor_write ON public.backup_runs;
-- DROP POLICY IF EXISTS cms_public_update ON public.backup_runs;
-- CREATE POLICY cmsuser_all ON public.backup_runs FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.backup_schedules;
-- DROP POLICY IF EXISTS cms_public_read ON public.backup_schedules;
-- DROP POLICY IF EXISTS cms_actor_write ON public.backup_schedules;
-- DROP POLICY IF EXISTS cms_public_update ON public.backup_schedules;
-- CREATE POLICY cmsuser_all ON public.backup_schedules FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contest_exposures;
-- DROP POLICY IF EXISTS cms_public_read ON public.contest_exposures;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contest_exposures;
-- DROP POLICY IF EXISTS cms_public_update ON public.contest_exposures;
-- CREATE POLICY cmsuser_all ON public.contest_exposures FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contest_tasks;
-- DROP POLICY IF EXISTS cms_public_read ON public.contest_tasks;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contest_tasks;
-- DROP POLICY IF EXISTS cms_public_update ON public.contest_tasks;
-- CREATE POLICY cmsuser_all ON public.contest_tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contest_teams;
-- DROP POLICY IF EXISTS cms_public_read ON public.contest_teams;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contest_teams;
-- DROP POLICY IF EXISTS cms_public_update ON public.contest_teams;
-- CREATE POLICY cmsuser_all ON public.contest_teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contest_usernames;
-- DROP POLICY IF EXISTS cms_public_read ON public.contest_usernames;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contest_usernames;
-- DROP POLICY IF EXISTS cms_public_update ON public.contest_usernames;
-- CREATE POLICY cmsuser_all ON public.contest_usernames FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contest_usernames_history;
-- DROP POLICY IF EXISTS cms_public_read ON public.contest_usernames_history;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contest_usernames_history;
-- DROP POLICY IF EXISTS cms_public_update ON public.contest_usernames_history;
-- CREATE POLICY cmsuser_all ON public.contest_usernames_history FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contestant_group_memberships;
-- DROP POLICY IF EXISTS cms_public_read ON public.contestant_group_memberships;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contestant_group_memberships;
-- DROP POLICY IF EXISTS cms_public_update ON public.contestant_group_memberships;
-- CREATE POLICY cmsuser_all ON public.contestant_group_memberships FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contestant_groups;
-- DROP POLICY IF EXISTS cms_public_read ON public.contestant_groups;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contestant_groups;
-- DROP POLICY IF EXISTS cms_public_update ON public.contestant_groups;
-- CREATE POLICY cmsuser_all ON public.contestant_groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.contests;
-- DROP POLICY IF EXISTS cms_public_read ON public.contests;
-- DROP POLICY IF EXISTS cms_actor_write ON public.contests;
-- DROP POLICY IF EXISTS cms_public_update ON public.contests;
-- CREATE POLICY cmsuser_all ON public.contests FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.datasets;
-- DROP POLICY IF EXISTS cms_public_read ON public.datasets;
-- DROP POLICY IF EXISTS cms_actor_write ON public.datasets;
-- DROP POLICY IF EXISTS cms_public_update ON public.datasets;
-- CREATE POLICY cmsuser_all ON public.datasets FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.evaluations;
-- DROP POLICY IF EXISTS cms_public_read ON public.evaluations;
-- DROP POLICY IF EXISTS cms_actor_write ON public.evaluations;
-- DROP POLICY IF EXISTS cms_public_update ON public.evaluations;
-- CREATE POLICY cmsuser_all ON public.evaluations FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.executables;
-- DROP POLICY IF EXISTS cms_public_read ON public.executables;
-- DROP POLICY IF EXISTS cms_actor_write ON public.executables;
-- DROP POLICY IF EXISTS cms_public_update ON public.executables;
-- CREATE POLICY cmsuser_all ON public.executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.files;
-- DROP POLICY IF EXISTS cms_public_read ON public.files;
-- DROP POLICY IF EXISTS cms_actor_write ON public.files;
-- DROP POLICY IF EXISTS cms_public_update ON public.files;
-- CREATE POLICY cmsuser_all ON public.files FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.fsobjects;
-- DROP POLICY IF EXISTS cms_public_read ON public.fsobjects;
-- DROP POLICY IF EXISTS cms_actor_write ON public.fsobjects;
-- DROP POLICY IF EXISTS cms_public_update ON public.fsobjects;
-- CREATE POLICY cmsuser_all ON public.fsobjects FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.group_permissions;
-- DROP POLICY IF EXISTS cms_public_read ON public.group_permissions;
-- DROP POLICY IF EXISTS cms_actor_write ON public.group_permissions;
-- DROP POLICY IF EXISTS cms_public_update ON public.group_permissions;
-- CREATE POLICY cmsuser_all ON public.group_permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.groups;
-- DROP POLICY IF EXISTS cms_public_read ON public.groups;
-- DROP POLICY IF EXISTS cms_actor_write ON public.groups;
-- DROP POLICY IF EXISTS cms_public_update ON public.groups;
-- CREATE POLICY cmsuser_all ON public.groups FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.login_surfaces;
-- DROP POLICY IF EXISTS cms_public_read ON public.login_surfaces;
-- DROP POLICY IF EXISTS cms_actor_write ON public.login_surfaces;
-- DROP POLICY IF EXISTS cms_public_update ON public.login_surfaces;
-- CREATE POLICY cmsuser_all ON public.login_surfaces FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.managers;
-- DROP POLICY IF EXISTS cms_public_read ON public.managers;
-- DROP POLICY IF EXISTS cms_actor_write ON public.managers;
-- DROP POLICY IF EXISTS cms_public_update ON public.managers;
-- CREATE POLICY cmsuser_all ON public.managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.messages;
-- DROP POLICY IF EXISTS cms_public_read ON public.messages;
-- DROP POLICY IF EXISTS cms_actor_write ON public.messages;
-- DROP POLICY IF EXISTS cms_public_update ON public.messages;
-- CREATE POLICY cmsuser_all ON public.messages FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.monitor_targets;
-- DROP POLICY IF EXISTS cms_public_read ON public.monitor_targets;
-- DROP POLICY IF EXISTS cms_actor_write ON public.monitor_targets;
-- DROP POLICY IF EXISTS cms_public_update ON public.monitor_targets;
-- CREATE POLICY cmsuser_all ON public.monitor_targets FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.participations;
-- DROP POLICY IF EXISTS cms_public_read ON public.participations;
-- DROP POLICY IF EXISTS cms_actor_write ON public.participations;
-- DROP POLICY IF EXISTS cms_public_update ON public.participations;
-- CREATE POLICY cmsuser_all ON public.participations FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.permissions;
-- DROP POLICY IF EXISTS cms_public_read ON public.permissions;
-- DROP POLICY IF EXISTS cms_actor_write ON public.permissions;
-- DROP POLICY IF EXISTS cms_public_update ON public.permissions;
-- CREATE POLICY cmsuser_all ON public.permissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.questions;
-- DROP POLICY IF EXISTS cms_public_read ON public.questions;
-- DROP POLICY IF EXISTS cms_actor_write ON public.questions;
-- DROP POLICY IF EXISTS cms_public_update ON public.questions;
-- CREATE POLICY cmsuser_all ON public.questions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_config;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_config;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_config;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_config;
-- CREATE POLICY cmsuser_all ON public.ranking_config FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_contests;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_contests;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_contests;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_contests;
-- CREATE POLICY cmsuser_all ON public.ranking_contests FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_hidden;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_hidden;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_hidden;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_hidden;
-- CREATE POLICY cmsuser_all ON public.ranking_hidden FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_overrides;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_overrides;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_overrides;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_overrides;
-- CREATE POLICY cmsuser_all ON public.ranking_overrides FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_settings;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_settings;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_settings;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_settings;
-- CREATE POLICY cmsuser_all ON public.ranking_settings FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_subchanges;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_subchanges;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_subchanges;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_subchanges;
-- CREATE POLICY cmsuser_all ON public.ranking_subchanges FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_submissions;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_submissions;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_submissions;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_submissions;
-- CREATE POLICY cmsuser_all ON public.ranking_submissions FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_tasks;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_tasks;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_tasks;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_tasks;
-- CREATE POLICY cmsuser_all ON public.ranking_tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_teams;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_teams;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_teams;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_teams;
-- CREATE POLICY cmsuser_all ON public.ranking_teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.ranking_users;
-- DROP POLICY IF EXISTS cms_public_read ON public.ranking_users;
-- DROP POLICY IF EXISTS cms_actor_write ON public.ranking_users;
-- DROP POLICY IF EXISTS cms_public_update ON public.ranking_users;
-- CREATE POLICY cmsuser_all ON public.ranking_users FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.security_blocks;
-- DROP POLICY IF EXISTS cms_public_read ON public.security_blocks;
-- DROP POLICY IF EXISTS cms_actor_write ON public.security_blocks;
-- DROP POLICY IF EXISTS cms_public_update ON public.security_blocks;
-- CREATE POLICY cmsuser_all ON public.security_blocks FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.security_findings;
-- DROP POLICY IF EXISTS cms_public_read ON public.security_findings;
-- DROP POLICY IF EXISTS cms_actor_write ON public.security_findings;
-- DROP POLICY IF EXISTS cms_public_update ON public.security_findings;
-- CREATE POLICY cmsuser_all ON public.security_findings FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.security_waivers;
-- DROP POLICY IF EXISTS cms_public_read ON public.security_waivers;
-- DROP POLICY IF EXISTS cms_actor_write ON public.security_waivers;
-- DROP POLICY IF EXISTS cms_public_update ON public.security_waivers;
-- CREATE POLICY cmsuser_all ON public.security_waivers FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.services;
-- DROP POLICY IF EXISTS cms_public_read ON public.services;
-- DROP POLICY IF EXISTS cms_actor_write ON public.services;
-- DROP POLICY IF EXISTS cms_public_update ON public.services;
-- CREATE POLICY cmsuser_all ON public.services FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.statements;
-- DROP POLICY IF EXISTS cms_public_read ON public.statements;
-- DROP POLICY IF EXISTS cms_actor_write ON public.statements;
-- DROP POLICY IF EXISTS cms_public_update ON public.statements;
-- CREATE POLICY cmsuser_all ON public.statements FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.submission_results;
-- DROP POLICY IF EXISTS cms_public_read ON public.submission_results;
-- DROP POLICY IF EXISTS cms_actor_write ON public.submission_results;
-- DROP POLICY IF EXISTS cms_public_update ON public.submission_results;
-- CREATE POLICY cmsuser_all ON public.submission_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.submissions;
-- CREATE POLICY cmsuser_select ON public.submissions FOR SELECT TO cmsuser USING (true);
-- CREATE POLICY cmsuser_insert ON public.submissions FOR INSERT TO cmsuser WITH CHECK (true);
-- CREATE POLICY cmsuser_update ON public.submissions FOR UPDATE TO cmsuser USING (true) WITH CHECK (true);
-- CREATE POLICY cmsuser_delete ON public.submissions FOR DELETE TO cmsuser USING (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.tasks;
-- DROP POLICY IF EXISTS cms_public_read ON public.tasks;
-- DROP POLICY IF EXISTS cms_actor_write ON public.tasks;
-- DROP POLICY IF EXISTS cms_public_update ON public.tasks;
-- CREATE POLICY cmsuser_all ON public.tasks FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.teams;
-- DROP POLICY IF EXISTS cms_public_read ON public.teams;
-- DROP POLICY IF EXISTS cms_actor_write ON public.teams;
-- DROP POLICY IF EXISTS cms_public_update ON public.teams;
-- CREATE POLICY cmsuser_all ON public.teams FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.testcases;
-- DROP POLICY IF EXISTS cms_public_read ON public.testcases;
-- DROP POLICY IF EXISTS cms_actor_write ON public.testcases;
-- DROP POLICY IF EXISTS cms_public_update ON public.testcases;
-- CREATE POLICY cmsuser_all ON public.testcases FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.tokens;
-- DROP POLICY IF EXISTS cms_public_read ON public.tokens;
-- DROP POLICY IF EXISTS cms_actor_write ON public.tokens;
-- DROP POLICY IF EXISTS cms_public_update ON public.tokens;
-- CREATE POLICY cmsuser_all ON public.tokens FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.user_test_executables;
-- DROP POLICY IF EXISTS cms_public_read ON public.user_test_executables;
-- DROP POLICY IF EXISTS cms_actor_write ON public.user_test_executables;
-- DROP POLICY IF EXISTS cms_public_update ON public.user_test_executables;
-- CREATE POLICY cmsuser_all ON public.user_test_executables FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.user_test_files;
-- DROP POLICY IF EXISTS cms_public_read ON public.user_test_files;
-- DROP POLICY IF EXISTS cms_actor_write ON public.user_test_files;
-- DROP POLICY IF EXISTS cms_public_update ON public.user_test_files;
-- CREATE POLICY cmsuser_all ON public.user_test_files FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.user_test_managers;
-- DROP POLICY IF EXISTS cms_public_read ON public.user_test_managers;
-- DROP POLICY IF EXISTS cms_actor_write ON public.user_test_managers;
-- DROP POLICY IF EXISTS cms_public_update ON public.user_test_managers;
-- CREATE POLICY cmsuser_all ON public.user_test_managers FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.user_test_results;
-- DROP POLICY IF EXISTS cms_public_read ON public.user_test_results;
-- DROP POLICY IF EXISTS cms_actor_write ON public.user_test_results;
-- DROP POLICY IF EXISTS cms_public_update ON public.user_test_results;
-- CREATE POLICY cmsuser_all ON public.user_test_results FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.user_tests;
-- DROP POLICY IF EXISTS cms_public_read ON public.user_tests;
-- DROP POLICY IF EXISTS cms_actor_write ON public.user_tests;
-- DROP POLICY IF EXISTS cms_public_update ON public.user_tests;
-- CREATE POLICY cmsuser_all ON public.user_tests FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.username_policies;
-- DROP POLICY IF EXISTS cms_public_read ON public.username_policies;
-- DROP POLICY IF EXISTS cms_actor_write ON public.username_policies;
-- DROP POLICY IF EXISTS cms_public_update ON public.username_policies;
-- CREATE POLICY cmsuser_all ON public.username_policies FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.users;
-- DROP POLICY IF EXISTS cms_public_read ON public.users;
-- DROP POLICY IF EXISTS cms_actor_write ON public.users;
-- DROP POLICY IF EXISTS cms_public_update ON public.users;
-- CREATE POLICY cmsuser_all ON public.users FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS cms_actor_all ON public.wirings;
-- DROP POLICY IF EXISTS cms_public_read ON public.wirings;
-- DROP POLICY IF EXISTS cms_actor_write ON public.wirings;
-- DROP POLICY IF EXISTS cms_public_update ON public.wirings;
-- CREATE POLICY cmsuser_all ON public.wirings FOR ALL TO cmsuser USING (true) WITH CHECK (true);
-- The helper functions go with it (nothing else references them):
-- DROP FUNCTION IF EXISTS public.cms_actor_is_staff_or_auth();
-- DROP FUNCTION IF EXISTS public.cms_actor_is_staff();
-- DROP FUNCTION IF EXISTS public.cms_actor_any(text[]);
-- DROP FUNCTION IF EXISTS public.cms_actor_admin_id();
-- DROP FUNCTION IF EXISTS public.cms_actor();
