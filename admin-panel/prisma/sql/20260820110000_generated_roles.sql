-- 20260820110000_generated_roles.sql — GENERATED — do not hand-edit
-- Source: admin-panel/prisma/roles/catalog.tsv + admin-panel/prisma/roles/grants.tsv
-- Generator: scripts/__generate_role_sql.sh
-- To regenerate: bash scripts/__generate_role_sql.sh --write
-- To verify freshness (CI): bash scripts/__generate_role_sql.sh --check
-- Scope: 22 roles (5 platform, 17 admin) · 8 table grants · 1 sequence grant · 8 policies on public.admins
--
-- WHY this file exists: WS-75 gives each capability its own database identity instead of every
-- module sharing one, so a bug in one module stops being a grant on the whole database. This is
-- the foundation slice: the role catalog, plus the column grants and RLS policies for `admins`,
-- the table whose matrix was exercised against a real database before it was written down.
--
-- WHAT IT DELIBERATELY LEAVES UNDONE, because each omission is what makes it safe to apply to a
-- production schema with the application running:
--   * table ownership is untouched and nothing is taken away from the role the app uses today,
--     so the running services keep working exactly as they do now;
--   * no password: every LOGIN role is created with PASSWORD NULL, so no secret enters the
--     repository, and the secret step is the only thing that sets a credential;
--   * no BYPASSRLS: catalog.tsv records that cms_platform_backup wants it, but creating a
--     bypassing role needs superuser, and the running backup path is still cms_backup;
--   * no grants outside `admins`: every other domain follows in the slice that proves its
--     columns against the same rehearsal.
--
-- SAFETY: a policy is scoped `TO` one role, so these cannot widen what any other role reads.
-- For a cms_admin_* role the column grants are the boundary; the policy only admits rows it may
-- already see. No process connects as these roles until the panel holds one connection per role,
-- so applying this changes no current behavior.
--
-- WHY role creation tolerates insufficient_privilege but grants do not: `make prisma-sync`
-- re-applies this directory as the application role, which is NOCREATEROLE once the hardening
-- migration has run, and a re-apply must never abort a restart. If a role is absent for that
-- reason each grant block says so and does nothing, because a role that does not exist cannot be
-- granted to. A privilege error on a role that DOES exist aborts the apply: a role without its
-- policy reads zero rows, and zero rows reads as a missing record, not as a permission error.

-- ── Roles ────────────────────────────────────────────────────────────────────────────────
-- One row per catalog.tsv entry, in catalog order. The trailing note is the catalog comment,
-- so the file still says why each role exists. An existing role is left alone: its attributes
-- belong to whoever created it, and changing them here could lock a live connection out.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('cms_platform_owner', 'NOLOGIN'),                  -- owns tables and policies; used only by migrations
      ('cms_platform_migrator', 'LOGIN'),                 -- runs migrations as the owner; deploy host only
      ('cms_platform_backup', 'LOGIN'),                   -- pg_dump and restore, SELECT-only; cms_backup keeps serving until the swap
      ('cms_platform_breakglass', 'LOGIN'),               -- emergency DDL and repair, audited, never a web pool
      ('cms_platform_monitor', 'LOGIN'),                  -- metrics and health only, read-only, no customer data
      ('cms_admin_login', 'LOGIN'),                       -- pre-session login read: username, authentication, enabled
      ('cms_admin_read_contest', 'LOGIN'),                -- SELECT on contest content: contest, task, dataset, testcase, statement, attachment, group, manager
      ('cms_admin_write_contest', 'LOGIN'),               -- create, update, delete and switch contest content
      ('cms_admin_read_people', 'LOGIN'),                 -- SELECT on people tables, never a password or hash column
      ('cms_admin_write_people', 'LOGIN'),                -- create, update, delete, set and policy on people tables
      ('cms_admin_read_submission', 'LOGIN'),             -- SELECT on submission, result, evaluation, executable, file and token tables
      ('cms_admin_operate_submission', 'LOGIN'),          -- rejudge, recompute, delete, lane and token actions
      ('cms_admin_read_ops', 'LOGIN'),                    -- SELECT on monitor, container, service, deployment and maintenance tables
      ('cms_admin_operate_ops', 'LOGIN'),                 -- restart, deploy, control, test, enable and disable operational actions
      ('cms_admin_read_comms', 'LOGIN'),                  -- SELECT on questions, messages and announcements
      ('cms_admin_write_comms', 'LOGIN'),                 -- answer, ignore, send and publish communications
      ('cms_admin_read_security', 'LOGIN'),               -- SELECT on audit, bans, lockouts, WAF, TLS and patching
      ('cms_admin_write_security', 'LOGIN'),              -- unban, unlock, exempt, WAF, TLS and patch-waive; never admin credentials
      ('cms_admin_read_settings', 'LOGIN'),               -- SELECT on settings, env, appearance and ranking configuration
      ('cms_admin_write_settings', 'LOGIN'),              -- update settings and ranking overrides
      ('cms_admin_account_security', 'LOGIN'),            -- admin accounts, groups, permissions and overrides; the only role that touches password columns
      ('cms_admin_operate_backup', 'LOGIN')               -- backup metadata and restore actions, separate pool
    ) AS v(role, login)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I %s PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', r.role, r.login);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'role % not created: the applier lacks CREATEROLE (it exists after the first apply)', r.role;
      END;
    ELSE
      RAISE NOTICE 'role % exists: attributes left untouched', r.role;
    END IF;
  END LOOP;
END $$;

-- ── Column grants and RLS policies: public.admins ────────────────────────────────────────
-- One block per role. Each block applies its grants and then the policies for exactly those
-- verbs, so a grant can never exist without the policy that makes it visible.
--
-- WHY every writer also carries SELECT: `UPDATE ... WHERE username = ...` looks the row up
-- under the SELECT policy, and Prisma writes with INSERT ... RETURNING, which PostgreSQL
-- refuses when the new row is not visible to the writer. A role granted UPDATE alone updates
-- zero rows and reports success — the failure this catalog exists to make impossible.
--
-- WHY USING (true): the reach of each role is its column list, not a row predicate. Row-level
-- narrowing per admin arrives with the panel wiring, when the panel can announce an actor.
-- A bare `true` here therefore grants nothing a column grant has not already granted.
--
-- WHY the INSERT role also gets USAGE on the sequence behind admins.id: PostgreSQL checks
-- nextval() against the sequence, not the table, so a table grant alone leaves the create path
-- failing with a privilege error that names a different object than the one being written.

-- cms_admin_login on public.admins
DO $$
BEGIN
  IF to_regclass('public.admins') IS NULL THEN
    RAISE NOTICE 'public.admins is missing: no grants applied for cms_admin_login';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin_login') THEN
    RAISE NOTICE 'cms_admin_login is missing: no grants applied for it';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT (username, authentication, enabled) ON public.admins TO cms_admin_login';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_login_select ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_login_select ON public.admins FOR SELECT TO cms_admin_login USING (true)';
END $$;

-- cms_admin_read_people on public.admins
DO $$
BEGIN
  IF to_regclass('public.admins') IS NULL THEN
    RAISE NOTICE 'public.admins is missing: no grants applied for cms_admin_read_people';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin_read_people') THEN
    RAISE NOTICE 'cms_admin_read_people is missing: no grants applied for it';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT (id, username, name, enabled, last_login_at) ON public.admins TO cms_admin_read_people';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_read_people_select ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_read_people_select ON public.admins FOR SELECT TO cms_admin_read_people USING (true)';
END $$;

-- cms_admin_write_people on public.admins
DO $$
BEGIN
  IF to_regclass('public.admins') IS NULL THEN
    RAISE NOTICE 'public.admins is missing: no grants applied for cms_admin_write_people';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin_write_people') THEN
    RAISE NOTICE 'cms_admin_write_people is missing: no grants applied for it';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT (id, username) ON public.admins TO cms_admin_write_people';
  EXECUTE 'GRANT UPDATE (name, username) ON public.admins TO cms_admin_write_people';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_write_people_select ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_write_people_select ON public.admins FOR SELECT TO cms_admin_write_people USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_write_people_update ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_write_people_update ON public.admins FOR UPDATE TO cms_admin_write_people USING (true) WITH CHECK (true)';
END $$;

-- cms_admin_account_security on public.admins
DO $$
BEGIN
  IF to_regclass('public.admins') IS NULL THEN
    RAISE NOTICE 'public.admins is missing: no grants applied for cms_admin_account_security';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin_account_security') THEN
    RAISE NOTICE 'cms_admin_account_security is missing: no grants applied for it';
    RETURN;
  END IF;
  EXECUTE 'GRANT SELECT (id, username) ON public.admins TO cms_admin_account_security';
  EXECUTE 'GRANT UPDATE (authentication, enabled) ON public.admins TO cms_admin_account_security';
  EXECUTE 'GRANT INSERT (username, authentication, enabled, name) ON public.admins TO cms_admin_account_security';
  IF to_regclass('public.admins_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SEQUENCE public.admins_id_seq TO cms_admin_account_security';
  ELSE
    RAISE NOTICE 'public.admins_id_seq is missing: cms_admin_account_security cannot allocate a new public.admins row';
  END IF;
  EXECUTE 'GRANT DELETE ON public.admins TO cms_admin_account_security';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_account_security_select ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_account_security_select ON public.admins FOR SELECT TO cms_admin_account_security USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_account_security_update ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_account_security_update ON public.admins FOR UPDATE TO cms_admin_account_security USING (true) WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_account_security_insert ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_account_security_insert ON public.admins FOR INSERT TO cms_admin_account_security WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS cms_admin_account_security_delete ON public.admins';
  EXECUTE 'CREATE POLICY cms_admin_account_security_delete ON public.admins FOR DELETE TO cms_admin_account_security USING (true)';
END $$;
