-- Backfill: map legacy admin permission booleans (preserved in cms_legacy._legacy_admin_permissions) to group memberships.
-- WHY: Existing admins have fine-grained boolean flags (permission_all, permission_contests,
-- permission_tasks, permission_users, permission_messaging) that predate the group model.
-- prisma db push with the new schema drops those columns from admins, so this backfill
-- must read from cms_legacy._legacy_admin_permissions captured pre-push by 20260810120000. Without
-- that table there is nothing to migrate.
-- WHY cms_legacy schema: the capture table lives outside public so Prisma db push ignores it and
-- the RLS assertion (which only inspects public) does not false-fire. Backfill reads from
-- cms_legacy._legacy_admin_permissions, with a forward-only fallback to public._legacy_admin_permissions
-- if an older capture created it there.
-- Mapping rationale: permission_all→Superadmin, permission_contests→Contest Manager,
-- permission_tasks→Problem Setter, permission_users→Viewer, permission_messaging→Messaging.
-- WHY forward-only and idempotent: guarded by existence checks on the legacy table
-- and on groups (fresh databases have neither, so it is a no-op); every INSERT uses
-- ON CONFLICT DO NOTHING so re-runs never duplicate. State the actual precondition: safe
-- to run before or after the boolean DROP, on fresh or upgraded databases, repeatedly.

-- Ensure the 5 groups referenced by this backfill exist (prod-faithful: on a real
-- upgrade the groups rows do not exist yet — the seed that creates them runs after
-- the RBAC tables exist, i.e. after this migration; without this block the guard
-- `IF EXISTS (SELECT 1 FROM groups WHERE name = ...)` makes the backfill a no-op).
-- WHY seeded rows must match the seed: admin-panel/prisma/seed-permissions.ts
-- upserts groups by name with (description, is_seeded=true); rows inserted here
-- use the same shape so the later seed upsert updates them in place without
-- duplication. Guarded to be idempotent when the seed already ran.
DO $$
BEGIN
  IF to_regclass('public.groups') IS NOT NULL THEN
    INSERT INTO groups (name, description, is_seeded)
    VALUES
      ('Superadmin', 'Unrestricted access to every permission in the registry.', true),
      ('Problem Setter', 'Authors tasks, datasets, statements and test data.', true),
      ('Contest Manager', 'Runs contests end to end, from creation through ranking.', true),
      ('Messaging', 'Handles clarifications, messages and announcements.', true),
      ('Viewer', 'Read-only access to public contest data.', true)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

DO $$
DECLARE
  _legacy_schema text;
  _legacy_table  text;
  _legacy_count  integer;
BEGIN
  -- WHY forward-only dual-location check: 20260810120000 now creates cms_legacy._legacy_admin_permissions,
  -- but an already-migrated DB may still have public._legacy_admin_permissions from the old location.
  -- Prefer cms_legacy if present, else fall back to public. If neither exists, skip cleanly.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cms_legacy' AND table_name = '_legacy_admin_permissions') THEN
    _legacy_schema := 'cms_legacy';
    _legacy_table  := 'cms_legacy._legacy_admin_permissions';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_legacy_admin_permissions') THEN
    _legacy_schema := 'public';
    _legacy_table  := 'public._legacy_admin_permissions';
  ELSE
    RAISE NOTICE 'backfill skip: _legacy_admin_permissions does not exist in cms_legacy or public (fresh DB or capture not yet run)';
    RETURN;
  END IF;

  EXECUTE format('SELECT count(*) FROM %s', _legacy_table) INTO _legacy_count;
  IF _legacy_count = 0 THEN
    RAISE NOTICE 'backfill skip: % is empty', _legacy_table;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'groups') THEN
    RAISE NOTICE 'backfill skip: groups table does not exist';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_groups') THEN
    RAISE NOTICE 'backfill skip: admin_groups table does not exist';
    RETURN;
  END IF;

  -- 1. permission_all → Superadmin
  -- WHY EXISTS guard per join: if the seed has not run, the group row is absent
  -- and the INSERT would produce zero rows anyway; explicit check avoids a join
  -- against an empty groups table being misread as an error.
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Superadmin') THEN
    EXECUTE format('
      INSERT INTO admin_groups (admin_id, group_id)
      SELECT l.id, g.id
      FROM %s l
      JOIN groups g ON g.name = ''Superadmin''
      WHERE l.permission_all = true
      ON CONFLICT (admin_id, group_id) DO NOTHING', _legacy_table);
  END IF;

  -- 2. permission_contests → Contest Manager (admins without permission_all)
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Contest Manager') THEN
    EXECUTE format('
      INSERT INTO admin_groups (admin_id, group_id)
      SELECT l.id, g.id
      FROM %s l
      JOIN groups g ON g.name = ''Contest Manager''
      WHERE l.permission_contests = true AND l.permission_all IS DISTINCT FROM true
      ON CONFLICT (admin_id, group_id) DO NOTHING', _legacy_table);
  END IF;

  -- 3. permission_tasks → Problem Setter
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Problem Setter') THEN
    EXECUTE format('
      INSERT INTO admin_groups (admin_id, group_id)
      SELECT l.id, g.id
      FROM %s l
      JOIN groups g ON g.name = ''Problem Setter''
      WHERE l.permission_tasks = true AND l.permission_all IS DISTINCT FROM true
      ON CONFLICT (admin_id, group_id) DO NOTHING', _legacy_table);
  END IF;

  -- 4. permission_users → Viewer (closest existing group for user-read access)
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Viewer') THEN
    EXECUTE format('
      INSERT INTO admin_groups (admin_id, group_id)
      SELECT l.id, g.id
      FROM %s l
      JOIN groups g ON g.name = ''Viewer''
      WHERE l.permission_users = true AND l.permission_all IS DISTINCT FROM true
      ON CONFLICT (admin_id, group_id) DO NOTHING', _legacy_table);
  END IF;

  -- 5. permission_messaging → Messaging
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Messaging') THEN
    EXECUTE format('
      INSERT INTO admin_groups (admin_id, group_id)
      SELECT l.id, g.id
      FROM %s l
      JOIN groups g ON g.name = ''Messaging''
      WHERE l.permission_messaging = true AND l.permission_all IS DISTINCT FROM true
      ON CONFLICT (admin_id, group_id) DO NOTHING', _legacy_table);
  END IF;
END $$;

-- Verification: report how many admins were linked to each group, and how many got none.
-- WHY DO guard: on a fresh DB before the permission tables exist the plain SELECT would
-- ERROR and abort the migration; the guard makes verification informational and
-- never-failing while preserving output when tables are present.
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'groups')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_groups')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admins') THEN
    RAISE NOTICE 'backfill verification skip: required tables not present';
    RETURN;
  END IF;

  FOR r IN
    SELECT g.name AS group_name, COUNT(ag.admin_id) AS admins_linked
    FROM groups g
    LEFT JOIN admin_groups ag ON ag.group_id = g.id
    WHERE g.is_seeded = true
    GROUP BY g.id, g.name
    ORDER BY g.name
  LOOP
    RAISE NOTICE 'group %: % admins_linked', r.group_name, r.admins_linked;
  END LOOP;

  FOR r IN
    SELECT COUNT(*) AS admins_with_no_groups
    FROM admins a
    WHERE NOT EXISTS (SELECT 1 FROM admin_groups ag WHERE ag.admin_id = a.id)
  LOOP
    RAISE NOTICE 'admins_with_no_groups: %', r.admins_with_no_groups;
  END LOOP;
END $$;
