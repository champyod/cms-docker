-- Backfill: map legacy admin permission booleans (preserved in _legacy_admin_permissions) to group memberships.
-- WHY: Existing admins have fine-grained boolean flags (permission_all, permission_contests,
-- permission_tasks, permission_users, permission_messaging) that predate the group model.
-- prisma db push with the new schema drops those columns from admins, so this backfill
-- must read from _legacy_admin_permissions captured pre-push by 20260810120000. Without
-- that table there is nothing to migrate.
-- Mapping rationale: permission_all→Superadmin, permission_contests→Contest Manager,
-- permission_tasks→Problem Setter, permission_users→Viewer, permission_messaging→Messaging.
-- WHY forward-only and idempotent: guarded by existence checks on _legacy_admin_permissions
-- and on groups (fresh databases have neither, so it is a no-op); every INSERT uses
-- ON CONFLICT DO NOTHING so re-runs never duplicate. State the actual precondition: safe
-- to run before or after the boolean DROP, on fresh or upgraded databases, repeatedly.

DO $$
BEGIN
  -- WHY guard: on a fresh database _legacy_admin_permissions is empty or groups have
  -- not been seeded yet — nothing to backfill so we skip cleanly.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_legacy_admin_permissions') THEN
    RAISE NOTICE 'backfill skip: _legacy_admin_permissions does not exist (fresh DB or capture not yet run)';
    RETURN;
  END IF;

  IF (SELECT COUNT(*) FROM _legacy_admin_permissions) = 0 THEN
    RAISE NOTICE 'backfill skip: _legacy_admin_permissions is empty';
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
    INSERT INTO admin_groups (admin_id, group_id)
    SELECT l.id, g.id
    FROM _legacy_admin_permissions l
    JOIN groups g ON g.name = 'Superadmin'
    WHERE l.permission_all = true
    ON CONFLICT (admin_id, group_id) DO NOTHING;
  END IF;

  -- 2. permission_contests → Contest Manager (admins without permission_all)
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Contest Manager') THEN
    INSERT INTO admin_groups (admin_id, group_id)
    SELECT l.id, g.id
    FROM _legacy_admin_permissions l
    JOIN groups g ON g.name = 'Contest Manager'
    WHERE l.permission_contests = true AND l.permission_all IS DISTINCT FROM true
    ON CONFLICT (admin_id, group_id) DO NOTHING;
  END IF;

  -- 3. permission_tasks → Problem Setter
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Problem Setter') THEN
    INSERT INTO admin_groups (admin_id, group_id)
    SELECT l.id, g.id
    FROM _legacy_admin_permissions l
    JOIN groups g ON g.name = 'Problem Setter'
    WHERE l.permission_tasks = true AND l.permission_all IS DISTINCT FROM true
    ON CONFLICT (admin_id, group_id) DO NOTHING;
  END IF;

  -- 4. permission_users → Viewer (closest existing group for user-read access)
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Viewer') THEN
    INSERT INTO admin_groups (admin_id, group_id)
    SELECT l.id, g.id
    FROM _legacy_admin_permissions l
    JOIN groups g ON g.name = 'Viewer'
    WHERE l.permission_users = true AND l.permission_all IS DISTINCT FROM true
    ON CONFLICT (admin_id, group_id) DO NOTHING;
  END IF;

  -- 5. permission_messaging → Messaging
  IF EXISTS (SELECT 1 FROM groups WHERE name = 'Messaging') THEN
    INSERT INTO admin_groups (admin_id, group_id)
    SELECT l.id, g.id
    FROM _legacy_admin_permissions l
    JOIN groups g ON g.name = 'Messaging'
    WHERE l.permission_messaging = true AND l.permission_all IS DISTINCT FROM true
    ON CONFLICT (admin_id, group_id) DO NOTHING;
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
