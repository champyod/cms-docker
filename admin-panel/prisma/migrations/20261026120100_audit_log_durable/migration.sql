-- 20261026120100_audit_log_durable/migration.sql
--
-- WHY THIS MIGRATION EXISTS: `audit_log` was append-only by ABSENCE — no UPDATE policy, no DELETE
-- policy — and absence is not prevention. Measured on a database at 30674794 (Postgres 15, the
-- production tag): an UPDATE or DELETE as `cmsuser` matched zero rows SILENTLY (no error, no
-- signal), `TRUNCATE audit_log` succeeded outright (row security does not apply to TRUNCATE), and
-- because `cmsuser` owns the table it could simply `ALTER TABLE audit_log NO FORCE ROW LEVEL
-- SECURITY` and then update any row it liked. The hash chain in src/lib/audit.ts detects a rewrite
-- after the fact and stops nothing. This migration turns the three real holes into refusals that
-- name what was attempted:
--
--   1. UPDATE          -> guard trigger raises (append-only, forever, for every role and actor).
--   2. DELETE          -> guard trigger raises unless the actor is `system:audit-retention` AND the
--                         row is older than the retention window. The RLS policy says the same thing
--                         again, so a future grant cannot widen it by accident.
--   3. TRUNCATE        -> guard trigger raises. This is the hole that mattered most: TRUNCATE
--                         bypasses row security entirely, so yesterday the whole log could vanish in
--                         one statement that no policy, policy test or panel action would notice.
--
-- WHAT IS STILL NOT PREVENTED, stated plainly: `cmsuser` owns this table today. An owner may
-- `ALTER TABLE ... DISABLE TRIGGER` / `NO FORCE ROW LEVEL SECURITY` / `DROP TABLE`, and no trigger
-- can refuse its own table's owner. The last block below transfers ownership to `cms_audit_owner`
-- (NOLOGIN, NOSUPERUSER, NOBYPASSRLS), which turns every one of those statements into
-- "must be owner of table audit_log" for the application role. That transfer needs a superuser, and
-- this cluster deliberately has none: `postgres --single` is the only route (the same route
-- `./cms db create|rename` already uses, see docs/DB-ROTATION.md). Until it has been run in a
-- maintenance window the block raises a NOTICE, and `make audit-verify` reports
-- `owner_separated: false` and exits non-zero — the state is loud, never assumed.
--
-- RETENTION IS A DECISION: 400 days, in public.cms_audit_retention_days() below and nowhere else.
-- WHY 400: a contest dispute surfaces months after the contest, and a 13-month floor covers one
-- full annual cycle (contest, appeal, off-season review, the same contest next year) with the
-- slack for a late claim. Changing it is a migration — i.e. a recorded decision — not an env var.
-- A prune writes one `audit_log_retention` anchor with the boundary it cut at, so a gap in the log
-- is provable as a decision rather than indistinguishable from a deleted row.

-- ── The retention window: one number, one place ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_audit_retention_days() RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$
    SELECT 400
  $$;

COMMENT ON FUNCTION public.cms_audit_retention_days() IS
  'Audit-log retention window in days. The ONLY place the number lives: the guard trigger, the '
  'retention service and the operator verifier all read it here. Changing it is a migration.';

-- Rows strictly older than this are eligible for pruning. Typed `timestamp` to match the column,
-- and derived through the session time zone so it compares against the stored values correctly.
CREATE OR REPLACE FUNCTION public.cms_audit_retention_cutoff() RETURNS timestamp(6)
  LANGUAGE sql STABLE AS $$
    SELECT (now() - make_interval(days => public.cms_audit_retention_days()))::timestamp(6)
  $$;

-- ── The guard: refusals that name the violation (never a silent no-op) ───────────────────────
CREATE OR REPLACE FUNCTION public.cms_audit_log_guard() RETURNS trigger
  LANGUAGE plpgsql AS $guard$
DECLARE
  _actor text := coalesce(public.cms_actor(), '<none>');
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: TRUNCATE refused (actor=%)', _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Retention removes rows oldest-first through public.cms_audit_prune(); it is the only path that deletes.';

  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: UPDATE of row % refused (actor=%)', OLD.id, _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A correction is a new row, never an edit: the chain hashes every field of the row it commits to.';
  END IF;

  -- DELETE: exactly one identity, and only outside the window.
  IF NOT public.cms_actor_any(ARRAY['system:audit-retention']) THEN
    RAISE EXCEPTION 'audit_log is append-only: DELETE of row % refused (actor=%)', OLD.id, _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only system:audit-retention prunes, and only through public.cms_audit_prune().';
  END IF;

  IF OLD."timestamp" >= public.cms_audit_retention_cutoff() THEN
    RAISE EXCEPTION 'audit_log retention refused: row % is inside the %-day window (timestamp=%)',
      OLD.id, public.cms_audit_retention_days(), OLD."timestamp"
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'The window is a decision, not a knob: shorten it with a migration, not with a DELETE.';
  END IF;

  RETURN OLD;
END
$guard$;

DROP TRIGGER IF EXISTS cms_audit_log_append_only ON public.audit_log;
CREATE TRIGGER cms_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.cms_audit_log_guard();

DROP TRIGGER IF EXISTS cms_audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER cms_audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cms_audit_log_guard();

-- WHY a STATEMENT trigger as well as the row guard: row-level security FILTERS. A `DELETE` by an
-- actor with no DELETE policy matched zero rows and returned "DELETE 0" — a silent no-op, which is
-- the behaviour this change exists to remove. A BEFORE STATEMENT trigger runs before the scan, so
-- the refusal happens whether or not anything would have matched.
CREATE OR REPLACE FUNCTION public.cms_audit_log_statement_guard() RETURNS trigger
  LANGUAGE plpgsql AS $guard$
DECLARE
  _actor text := coalesce(public.cms_actor(), '<none>');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: UPDATE refused (actor=%)', _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A correction is a new row, never an edit.';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: TRUNCATE refused (actor=%)', _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Retention removes rows oldest-first through public.cms_audit_prune().';
  END IF;
  IF NOT public.cms_actor_any(ARRAY['system:audit-retention']) THEN
    RAISE EXCEPTION 'audit_log is append-only: DELETE refused (actor=%)', _actor
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only system:audit-retention prunes, and only through public.cms_audit_prune().';
  END IF;
  RETURN NULL;
END
$guard$;

DROP TRIGGER IF EXISTS cms_audit_log_no_bulk_write ON public.audit_log;
CREATE TRIGGER cms_audit_log_no_bulk_write
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cms_audit_log_statement_guard();

-- The prune ledger is append-only with NO exception: an anchor is the proof that a gap was a
-- decision, so the one identity allowed to prune must not be able to delete the evidence either.
CREATE OR REPLACE FUNCTION public.cms_audit_anchor_guard() RETURNS trigger
  LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'audit_log_retention is append-only: % refused (actor=%)',
      TG_OP, coalesce(public.cms_actor(), '<none>')
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Anchors are never deleted or edited; a corrected prune is another anchor.';
END
$guard$;

DROP TRIGGER IF EXISTS cms_audit_retention_append_only ON public.audit_log_retention;
CREATE TRIGGER cms_audit_retention_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log_retention
  FOR EACH ROW EXECUTE FUNCTION public.cms_audit_anchor_guard();

DROP TRIGGER IF EXISTS cms_audit_retention_no_truncate ON public.audit_log_retention;
CREATE TRIGGER cms_audit_retention_no_truncate
  BEFORE TRUNCATE ON public.audit_log_retention
  FOR EACH STATEMENT EXECUTE FUNCTION public.cms_audit_anchor_guard();

-- ── The prune: the privileged maintenance path, callable only by the retention identity ──────
-- Deleting through this function is what makes "retention ran" and "somebody deleted rows"
-- distinguishable: every call that removes anything writes one anchor in the same transaction.
-- It is idempotent, bounded, and refuses to touch the newest row (a log whose tip disappeared
-- cannot be continued without a fork).
CREATE OR REPLACE FUNCTION public.cms_audit_prune(p_batch integer DEFAULT 5000)
  RETURNS TABLE (deleted bigint, anchor_id bigint, cutoff timestamp(6), retained_from bigint)
  LANGUAGE plpgsql AS $prune$
DECLARE
  _cutoff timestamp(6) := public.cms_audit_retention_cutoff();
  _first bigint;
  _last bigint;
  _last_hash text;
  _tip bigint;
  _removed bigint := 0;
  _prev text;
  _hash text;
  _anchor bigint;
  _retained bigint;
BEGIN
  IF NOT public.cms_actor_any(ARRAY['system:audit-retention']) THEN
    RAISE EXCEPTION 'cms_audit_prune refused: actor % is not system:audit-retention',
      coalesce(public.cms_actor(), '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT max(id) INTO _tip FROM public.audit_log;
  SELECT min(id) INTO _first FROM public.audit_log WHERE "timestamp" < _cutoff AND id < _tip;
  IF _first IS NULL THEN
    RETURN;
  END IF;

  SELECT id, entry_hash INTO _last, _last_hash
    FROM public.audit_log
   WHERE "timestamp" < _cutoff AND id < _tip
   ORDER BY id DESC LIMIT 1;

  DELETE FROM public.audit_log a
   WHERE a.id IN (
     SELECT id FROM public.audit_log
      WHERE "timestamp" < _cutoff AND id < _tip
      ORDER BY id ASC
      LIMIT greatest(p_batch, 1)
   );
  GET DIAGNOSTICS _removed = ROW_COUNT;

  SELECT min(id) INTO _retained FROM public.audit_log;

  -- The anchor chains to the previous anchor: sha256 over prev_hash || '|' || canonical, the same
  -- shape audit.ts uses for log rows. The canonical line is built from coalesced text so it is
  -- byte-stable across SQL and TypeScript (no JSON formatting to disagree about);
  -- admin-panel/src/lib/audit-chain.ts#canonicaliseAnchorRow is the other half.
  SELECT entry_hash INTO _prev FROM public.audit_log_retention ORDER BY id DESC LIMIT 1;
  _hash := encode(sha256(convert_to(
    coalesce(_prev, '') || '|' ||
    public.cms_audit_retention_days()::text || '|' ||
    to_char(_cutoff, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    _removed::text || '|' ||
    coalesce(_first::text, '') || '|' ||
    coalesce(_last::text, '') || '|' ||
    coalesce(_last_hash, '') || '|' ||
    coalesce(_retained::text, '') || '|' ||
    public.cms_actor(), 'UTF8')), 'hex');

  INSERT INTO public.audit_log_retention
    (window_days, cutoff, deleted_count, first_deleted_id, last_deleted_id, last_deleted_hash,
     retained_from_id, actor, entry_hash, prev_hash)
  VALUES
    (public.cms_audit_retention_days(), _cutoff, _removed, _first, _last, _last_hash,
     _retained, public.cms_actor(), _hash, _prev)
  RETURNING id INTO _anchor;

  RETURN QUERY SELECT _removed, _anchor, _cutoff, _retained;
END
$prune$;

REVOKE ALL ON FUNCTION public.cms_audit_prune(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cms_audit_prune(integer) TO cmsuser;

-- ── Privileges: the default set is SELECT + INSERT; DELETE is a deliberate, separate grant ────
-- WHY the REVOKE is here even though the owner keeps implicit rights today: it is what the ACL
-- says, it takes effect the moment ownership moves (below), and it means the DELETE that follows
-- is the one and only write privilege on this table that is not "append".
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log FROM cmsuser;
GRANT SELECT, INSERT ON TABLE public.audit_log TO cmsuser;

-- DELETE exists for one caller: public.cms_audit_prune(), which is itself gated on the actor. The
-- RLS policy in the generated set below states the same restriction, and the trigger states it a
-- third time, so a mistyped GRANT alone cannot delete a row.
GRANT DELETE ON TABLE public.audit_log TO cmsuser;

-- The sequence is a separate object: after an ownership change the INSERT path needs an explicit
-- USAGE/SELECT grant or recordAudit() fails on nextval().
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO cmsuser;

REVOKE ALL ON TABLE public.audit_log_retention FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.audit_log_retention TO cmsuser;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_retention_id_seq TO cmsuser;

-- ── Owner separation: the step that turns "the owner could disable this" into a refusal ──────
-- A guard trigger is only as strong as the role that owns the table: an owner may DISABLE TRIGGER,
-- NO FORCE ROW LEVEL SECURITY or DROP TABLE, and no trigger can refuse its own table's owner. So
-- the table (and the function it depends on) move to a role no service ever logs in as.
--
-- This needs a superuser, and the cluster has none by design (`postgres --single` is the only
-- route; docs/DB-ROTATION.md §"WHY single-user mode"). When this migration cannot perform the
-- transfer it says so — a NOTICE here, and `make audit-verify` exits non-zero with
-- `owner_separated: false` — because a control that silently did not apply is the defect this
-- change exists to remove. The bootstrap is scripts/__audit_owner_bootstrap.sh.
DO $owner$
DECLARE
  _owner text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_audit_owner') THEN
    BEGIN
      EXECUTE 'CREATE ROLE cms_audit_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE';
      RAISE NOTICE 'created role cms_audit_owner';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cms_audit_owner does not exist and % may not create it — run scripts/__audit_owner_bootstrap.sh in a maintenance window; make audit-verify will keep reporting owner_separated: false until then',
        current_user;
    END;
  END IF;

  SELECT pg_get_userbyid(relowner) INTO _owner
    FROM pg_class WHERE oid = 'public.audit_log'::regclass;

  IF _owner <> 'cms_audit_owner' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_audit_owner') THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.audit_log OWNER TO cms_audit_owner';
      RAISE NOTICE 'audit_log ownership transferred to cms_audit_owner';
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
      RAISE NOTICE 'audit_log is still owned by % — the guard trigger can be disabled by the app role; run scripts/__audit_owner_bootstrap.sh in a maintenance window (make audit-verify reports owner_separated: false until then)',
        _owner;
    END;
  END IF;

  -- The function moves with the table: an owner of the function could CREATE OR REPLACE it with a
  -- no-op body, which is the same hole by another door.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_audit_owner')
     AND pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.cms_audit_log_guard()'::regprocedure)) <> 'cms_audit_owner' THEN
    BEGIN
      EXECUTE 'ALTER FUNCTION public.cms_audit_log_guard() OWNER TO cms_audit_owner';
      EXECUTE 'ALTER FUNCTION public.cms_audit_log_statement_guard() OWNER TO cms_audit_owner';
      EXECUTE 'ALTER FUNCTION public.cms_audit_anchor_guard() OWNER TO cms_audit_owner';
      EXECUTE 'ALTER FUNCTION public.cms_audit_retention_days() OWNER TO cms_audit_owner';
      EXECUTE 'ALTER FUNCTION public.cms_audit_retention_cutoff() OWNER TO cms_audit_owner';
      EXECUTE 'ALTER FUNCTION public.cms_audit_prune(integer) OWNER TO cms_audit_owner';
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
      RAISE NOTICE 'guard functions are still owned by the application role; run scripts/__audit_owner_bootstrap.sh';
    END;
  END IF;
END
$owner$;

-- ── The generated policy set (supersedes 20261025120000_rls_actor_policies) ──────────────────
-- Rendering of `scripts/__generate_rls_sql.sh --emit-policies`; `make lint` diffs it. The only
-- difference from the previous rendering is audit_log's retention-scoped DELETE policy and the
-- read/append rules for the two audit tables; every other table's body is byte-identical.
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
);
CREATE POLICY cms_actor_append ON public.audit_log FOR INSERT TO cmsuser WITH CHECK (
  public.cms_actor_is_staff()
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
