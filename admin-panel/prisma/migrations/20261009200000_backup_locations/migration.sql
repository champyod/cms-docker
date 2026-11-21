-- CreateTable
CREATE TABLE "backup_locations" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_locations_pkey" PRIMARY KEY ("id")
);

-- SeedLocation: the system row stands for the legacy single tree the panel has
-- always archived into, so the picker and the scheduler have a target before
-- the first CRUD row exists. The id is the literal every pre-locations schedule
-- stored in "locationId" when it meant the default tree, so those pointers keep
-- resolving unchanged; the config list itself is retired, not migrated.
INSERT INTO "backup_locations" ("id", "label", "path", "isSystem", "createdAt", "updatedAt")
VALUES ('default', 'Primary volume', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- RetireUnknownLocationIds: ids that came from the retired config list have no
-- row to point at, so the FK below could not be added while they stood. NULL
-- keeps their meaning — the system location, the default tree.
UPDATE "backup_schedules" SET "locationId" = NULL
WHERE "locationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "backup_locations" WHERE "backup_locations"."id" = "backup_schedules"."locationId"
  );

-- CreateForeignKey
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "backup_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SeedRootActor: the attribution identity every script-side action is logged
-- under. Passwordless by construction — "authentication" is a value the login
-- verifier rejects (it is neither a plaintext: value nor a bcrypt hash), and
-- enabled = false makes findActiveAdmin refuse the row before any password
-- check runs. If an operator already owns the username, the row is theirs and
-- the seed below only links it.
INSERT INTO "admins" ("name", "username", "authentication", "enabled")
SELECT 'System actor', 'root', 'locked:system-actor', false
WHERE NOT EXISTS (SELECT 1 FROM "admins" WHERE "username" = 'root');

-- SeedRootGroup: the group the system actor holds every registry key through.
-- Links are selected from the permissions table rather than spelled out, so the
-- group carries exactly the keys the seed has registered — including all:all
-- and backup:schedule, the two the all:all wildcard expansion excludes.
INSERT INTO "groups" ("name", "description", "is_seeded")
SELECT 'root', 'System actor group: every permission in the registry, so script-side actions attribute to a fully privileged admin. Do not edit or delete.', true
WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = 'root');

INSERT INTO "group_permissions" ("group_id", "permission_id")
SELECT g."id", p."id"
FROM "groups" g
CROSS JOIN "permissions" p
WHERE g."name" = 'root'
ON CONFLICT DO NOTHING;

INSERT INTO "admin_groups" ("admin_id", "group_id")
SELECT a."id", g."id"
FROM "admins" a
JOIN "groups" g ON g."name" = 'root'
WHERE a."username" = 'root'
ON CONFLICT DO NOTHING;
