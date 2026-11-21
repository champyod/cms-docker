-- WHY: the ranking console authenticates a panel admin now, so this table is a second
-- identity plane that no product path creates rows in — a fresh install had none, which
-- made the console unreachable. Move any account an operator made by hand onto an admin
-- carrying ranking:read, then drop the table and the RLS policy that guarded it.

INSERT INTO "permissions" ("key", "module", "verb", "description")
VALUES ('ranking:read', 'ranking', 'read', 'Allow "read" operations on the "ranking" module.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "groups" ("name", "description", "is_seeded")
VALUES ('Scoreboard Console', 'Signs in to the ranking board and reads the scoreboard.', true)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "group_permissions" ("group_id", "permission_id")
SELECT g."id", p."id"
  FROM "groups" g, "permissions" p
 WHERE g."name" = 'Scoreboard Console' AND p."key" = 'ranking:read'
ON CONFLICT ("group_id", "permission_id") DO NOTHING;

-- The stored credential keeps its plaintext:/bcrypt: form: both tables verify it the same way.
INSERT INTO "admins" ("name", "username", "authentication", "enabled")
SELECT "username", "username", "password", "enabled"
  FROM "ranking_console_users"
ON CONFLICT ("username") DO NOTHING;

INSERT INTO "admin_groups" ("admin_id", "group_id")
SELECT a."id", g."id"
  FROM "admins" a
  JOIN "groups" g ON g."name" = 'Scoreboard Console'
 WHERE a."username" IN (SELECT "username" FROM "ranking_console_users")
ON CONFLICT ("admin_id", "group_id") DO NOTHING;

DROP TABLE IF EXISTS "ranking_console_users";
