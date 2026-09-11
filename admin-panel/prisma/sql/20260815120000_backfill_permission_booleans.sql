-- Backfill: map legacy admin permission booleans to group memberships.
-- WHY: Existing admins have fine-grained boolean flags (permission_all, permission_contests,
-- permission_tasks, permission_users, permission_messaging) that predate the group model.
-- This migration translates those flags into admin_groups rows so that every admin's access
-- is governed solely by groups going forward, without removing the original booleans.
-- Mapping rationale: permission_all→Superadmin, permission_contests→Contest Manager,
-- permission_tasks→Problem Setter, permission_users→Viewer, permission_messaging→Messaging.
-- Runs after the seed script so all group IDs are guaranteed to exist.

BEGIN;

-- 1. permission_all → Superadmin
INSERT INTO admin_groups (admin_id, group_id)
SELECT a.id, g.id
FROM admins a
JOIN groups g ON g.name = 'Superadmin'
WHERE a.permission_all = true
ON CONFLICT (admin_id, group_id) DO NOTHING;

-- 2. permission_contests → Contest Manager (admins without permission_all)
INSERT INTO admin_groups (admin_id, group_id)
SELECT a.id, g.id
FROM admins a
JOIN groups g ON g.name = 'Contest Manager'
WHERE a.permission_contests = true AND a.permission_all = false
ON CONFLICT (admin_id, group_id) DO NOTHING;

-- 3. permission_tasks → Problem Setter
INSERT INTO admin_groups (admin_id, group_id)
SELECT a.id, g.id
FROM admins a
JOIN groups g ON g.name = 'Problem Setter'
WHERE a.permission_tasks = true AND a.permission_all = false
ON CONFLICT (admin_id, group_id) DO NOTHING;

-- 4. permission_users → Viewer (closest existing group for user-read access)
INSERT INTO admin_groups (admin_id, group_id)
SELECT a.id, g.id
FROM admins a
JOIN groups g ON g.name = 'Viewer'
WHERE a.permission_users = true AND a.permission_all = false
ON CONFLICT (admin_id, group_id) DO NOTHING;

-- 5. permission_messaging → Messaging
INSERT INTO admin_groups (admin_id, group_id)
SELECT a.id, g.id
FROM admins a
JOIN groups g ON g.name = 'Messaging'
WHERE a.permission_messaging = true AND a.permission_all = false
ON CONFLICT (admin_id, group_id) DO NOTHING;

COMMIT;

-- Verification: report how many admins were linked to each group, and how many got none.
SELECT
  g.name AS group_name,
  COUNT(ag.admin_id) AS admins_linked
FROM groups g
LEFT JOIN admin_groups ag ON ag.group_id = g.id
WHERE g.is_seeded = true
GROUP BY g.id, g.name
ORDER BY g.name;

SELECT
  COUNT(*) AS admins_with_no_groups
FROM admins a
WHERE NOT EXISTS (
  SELECT 1 FROM admin_groups ag WHERE ag.admin_id = a.id
);
