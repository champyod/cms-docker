-- WHY: the seed upserts groups by name and never renames, so a renamed group would
-- leave its old row behind and seed a second, empty one beside it. Each statement is a
-- no-op where the old name is absent, which is the case on a fresh install.

UPDATE "groups" SET "name" = 'Storage' WHERE "name" = 'Storage Admin';

UPDATE "groups" SET "name" = 'Security' WHERE "name" = 'Security Admin';

-- Participant Manager was created by hand, so it also has to join the seeded set the
-- seed reconciles.
UPDATE "groups" SET "name" = 'Participant Manager', "is_seeded" = true
 WHERE "name" = 'User & participant';
