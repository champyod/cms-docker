-- 20261026130400_rls_policy_set_fresh/migration.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/schema.prisma
-- Generator: scripts/__generate_rls_sql.sh --emit-policies
--
-- WHY this migration exists: the generator gained three clauses after the previous rendering was
-- written — ingest read on `security_findings` and on `audit_log`, and ingest append on
-- `audit_log` (the `INSERT … RETURNING` rule: a writer that cannot see its own row is refused
-- 42501). Each landed as a hand-written single-policy patch so the live host could be fixed
-- without a regeneration, which left the committed rendering behind the generator and reddened
-- `scripts/__check_rls_coverage.sh` on the landing branch for every later lane.
--
-- WHY a superseding rendering and not an edit of 20261026120100_audit_log_durable: that
-- migration is already applied on both hosts, and migration history here is append-only — the
-- freshness check reads the NEWEST migration that carries the generated markers, so a later
-- rendering is the supported way to catch up. Every statement below is the generator's own
-- output, verbatim, and each CREATE POLICY is preceded by the DROP of the same name, so applying
-- it a second time to a database that already has the set is a no-op in effect.
--
-- To regenerate: bash scripts/__generate_rls_sql.sh --emit-policies
-- To verify freshness (CI): bash scripts/__generate_rls_sql.sh --check

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
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler'])
  $$;

-- The same set plus the pre-session login path. Used only on AUTH_BOOTSTRAP tables.
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff_or_auth() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler', 'system:auth'])
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
-- AUDIT_LOG: append-only. No UPDATE policy exists and UPDATE is refused by the guard trigger,
-- so editing a row is not a zero-row no-op for anyone. DELETE is granted to one identity only,
-- and the trigger refuses it for any row inside the retention window. No admin may forge an
-- attribution: an admin actor can only file a row under itself (or under nobody); only a system
-- identity names another.
DROP POLICY IF EXISTS cmsuser_all ON public.audit_log;
DROP POLICY IF EXISTS cmsuser_select ON public.audit_log;
DROP POLICY IF EXISTS cmsuser_insert ON public.audit_log;
DROP POLICY IF EXISTS cmsuser_delete ON public.audit_log;
DROP POLICY IF EXISTS cms_actor_read ON public.audit_log;
DROP POLICY IF EXISTS cms_actor_append ON public.audit_log;
DROP POLICY IF EXISTS cms_audit_retention_delete ON public.audit_log;
CREATE POLICY cms_actor_read ON public.audit_log FOR SELECT TO cmsuser USING (
  public.cms_actor_is_staff()
  OR public.cms_actor_any(ARRAY['system:audit-retention'])
  OR public.cms_actor_any(ARRAY['system:ingest'])
);
CREATE POLICY cms_actor_append ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (
  (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest']))
  AND (
    public.cms_actor_admin_id() IS NULL
    OR actor_id IS NULL
    OR actor_id = public.cms_actor_admin_id()
  )
);
CREATE POLICY cms_audit_retention_delete ON public.audit_log FOR DELETE TO cmsuser
  USING (public.cms_actor_any(ARRAY['system:audit-retention']));

-- audit_log_retention
-- AUDIT_LOG_RETENTION: the prune ledger. Staff read it; only the retention identity writes it,
-- because a prune is the one event that must be recorded without a human in the loop. No DELETE
-- policy exists at all — anchors are the proof a gap was a decision, so nothing may remove them.
DROP POLICY IF EXISTS cmsuser_all ON public.audit_log_retention;
DROP POLICY IF EXISTS cms_actor_all ON public.audit_log_retention;
DROP POLICY IF EXISTS cms_actor_read ON public.audit_log_retention;
DROP POLICY IF EXISTS cms_actor_append ON public.audit_log_retention;
CREATE POLICY cms_actor_read ON public.audit_log_retention FOR SELECT TO cmsuser USING (
  public.cms_actor_is_staff()
  OR public.cms_actor_any(ARRAY['system:audit-retention'])
);
CREATE POLICY cms_actor_append ON public.audit_log_retention FOR INSERT TO cmsuser WITH CHECK (
  public.cms_actor_is_staff()
  OR public.cms_actor_any(ARRAY['system:audit-retention'])
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
-- INGEST_WRITE: readable by staff AND the security-feed container, appended and updated by
-- both too. WHY the reader clause matters as much as the writer: Prisma upserts with
-- INSERT … RETURNING, and Postgres refuses RETURNING when the new row is not visible under
-- the SELECT policy (42501 "new row violates row-level security policy"). An ingest identity
-- that could write but not read its own row failed on every push while the policy looked
-- correct in isolation.
DROP POLICY IF EXISTS cmsuser_all ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_read ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_append ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_update ON public.security_findings;
DROP POLICY IF EXISTS cms_actor_delete ON public.security_findings;
CREATE POLICY cms_actor_read ON public.security_findings FOR SELECT TO cmsuser USING (public.cms_actor_is_staff() OR public.cms_actor_any(ARRAY['system:ingest']));
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
