-- 20261014120000_service_image_pull_policy/migration.sql
-- A per-row container image and pull policy: one services row may pin its own tag and say
-- whether the image is pulled always, only when missing, or never, instead of the whole
-- deployment sharing one IMG_TAG.
-- WHY guarded: a rebuilt database re-applies migrations and prod may already carry the
-- columns, so each statement is safe to run on either. The IF NOT EXISTS is the sole
-- deviation from the generated DDL, which emitted both clauses in one ALTER.

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "image" VARCHAR;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "pull_policy" VARCHAR NOT NULL DEFAULT 'missing';
