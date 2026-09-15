-- 20260912000000_admin_panel_objects/migration.sql
-- WHY: Creates the 7 Prisma-only tables (6 RBAC + monitor_targets) with indexes and FKs.
-- These tables are NOT created by cmsInitDB (src/cms/db/init.py) and must exist for RBAC.
-- WHY guarded: cmsInitDB on fresh installs creates the 6 RBAC tables when src/cms/db/permissions.py
-- is imported before metadata.create_all(); the guard makes this migration idempotent on both
-- fresh (cmsInitDB-first) and prod (skip-cmsInitDB) paths.
-- WHY to_regclass: checks existence of the table OID before DDL; safe on both paths.
-- Source: prisma migrate diff --from-schema-datamodel schema_prerbac.prisma --to-schema-datamodel schema.prisma --script
-- stripped of ALTER TABLE ... DROP COLUMN (handled by later migrations) to keep only CREATE TABLE/INDEX/FK.

-- CreateTable permissions (guarded)
DO $$ BEGIN
  IF to_regclass('public.permissions') IS NULL THEN
    CREATE TABLE "permissions" (
        "id" SERIAL NOT NULL,
        "key" VARCHAR NOT NULL,
        "module" VARCHAR NOT NULL,
        "verb" VARCHAR NOT NULL,
        "description" VARCHAR,
        CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable groups (guarded)
DO $$ BEGIN
  IF to_regclass('public.groups') IS NULL THEN
    CREATE TABLE "groups" (
        "id" SERIAL NOT NULL,
        "name" VARCHAR NOT NULL,
        "description" VARCHAR,
        "is_seeded" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable group_permissions (guarded)
DO $$ BEGIN
  IF to_regclass('public.group_permissions') IS NULL THEN
    CREATE TABLE "group_permissions" (
        "id" SERIAL NOT NULL,
        "group_id" INTEGER NOT NULL,
        "permission_id" INTEGER NOT NULL,
        CONSTRAINT "group_permissions_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable admin_groups (guarded)
DO $$ BEGIN
  IF to_regclass('public.admin_groups') IS NULL THEN
    CREATE TABLE "admin_groups" (
        "id" SERIAL NOT NULL,
        "admin_id" INTEGER NOT NULL,
        "group_id" INTEGER NOT NULL,
        CONSTRAINT "admin_groups_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable admin_permission_overrides (guarded)
DO $$ BEGIN
  IF to_regclass('public.admin_permission_overrides') IS NULL THEN
    CREATE TABLE "admin_permission_overrides" (
        "id" SERIAL NOT NULL,
        "admin_id" INTEGER NOT NULL,
        "permission_id" INTEGER NOT NULL,
        "effect" VARCHAR NOT NULL,
        "reason" VARCHAR,
        CONSTRAINT "admin_permission_overrides_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateTable audit_log (guarded) — column is actor_id (NOT admin_id)
DO $$ BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    CREATE TABLE "audit_log" (
        "id" BIGSERIAL NOT NULL,
        "actor_id" INTEGER,
        "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "verb" VARCHAR NOT NULL,
        "entity" VARCHAR NOT NULL,
        "entity_id" VARCHAR,
        "before_values" JSONB,
        "after_values" JSONB,
        "reason" VARCHAR,
        "ip" VARCHAR,
        "session_id" VARCHAR,
        "result" VARCHAR NOT NULL,
        "entry_hash" VARCHAR,
        "prev_hash" VARCHAR,
        CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admins"("id") ON UPDATE CASCADE ON DELETE SET NULL
    );
  END IF;
END $$;

-- AddForeignKey audit_log -> admins (guarded, with orphan check)
-- WHY: FK added to match CMS ORM (permissions.py AuditLog.actor_id SET NULL); orphan check
-- fails loud with actionable count instead of silently skipping or nulling.
DO $$ DECLARE orphan_count INTEGER; BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'audit_log_actor_id_fkey'
         AND connamespace = 'public'::regnamespace
     ) THEN
    SELECT COUNT(*) INTO orphan_count
    FROM "audit_log" a
    WHERE a."actor_id" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "admins" WHERE "admins"."id" = a."actor_id");
    IF orphan_count > 0 THEN
      RAISE EXCEPTION 'audit_log contains % orphan actor_id row(s) not present in admins.id; clean or null them before adding FK audit_log_actor_id_fkey', orphan_count;
    END IF;
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admins"("id") ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- CreateTable monitor_targets (guarded) — Prisma-only table
DO $$ BEGIN
  IF to_regclass('public.monitor_targets') IS NULL THEN
    CREATE TABLE "monitor_targets" (
        "id" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "interval" INTEGER NOT NULL DEFAULT 60,
        "timeout" INTEGER NOT NULL DEFAULT 5,
        "expectedStatus" INTEGER NOT NULL DEFAULT 200,
        "alertDiscord" BOOLEAN NOT NULL DEFAULT true,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "monitor_targets_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateIndex permissions (guarded by table existence + IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_key" ON "permissions"("key");
CREATE INDEX IF NOT EXISTS "ix_permissions_module" ON "permissions"("module");

-- CreateIndex groups
CREATE UNIQUE INDEX IF NOT EXISTS "groups_name_key" ON "groups"("name");

-- CreateIndex group_permissions
CREATE INDEX IF NOT EXISTS "ix_group_permissions_group_id" ON "group_permissions"("group_id");
CREATE INDEX IF NOT EXISTS "ix_group_permissions_permission_id" ON "group_permissions"("permission_id");
CREATE UNIQUE INDEX IF NOT EXISTS "group_permissions_group_id_permission_id_key" ON "group_permissions"("group_id", "permission_id");

-- CreateIndex admin_groups
CREATE INDEX IF NOT EXISTS "ix_admin_groups_admin_id" ON "admin_groups"("admin_id");
CREATE INDEX IF NOT EXISTS "ix_admin_groups_group_id" ON "admin_groups"("group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_groups_admin_id_group_id_key" ON "admin_groups"("admin_id", "group_id");

-- CreateIndex admin_permission_overrides
CREATE INDEX IF NOT EXISTS "ix_admin_permission_overrides_admin_id" ON "admin_permission_overrides"("admin_id");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_permission_overrides_admin_id_permission_id_key" ON "admin_permission_overrides"("admin_id", "permission_id");

-- CreateIndex audit_log — ix_audit_log_actor_id on actor_id (NOT admin_id)
CREATE INDEX IF NOT EXISTS "ix_audit_log_actor_id" ON "audit_log"("actor_id");
CREATE INDEX IF NOT EXISTS "ix_audit_log_entity" ON "audit_log"("entity");
CREATE INDEX IF NOT EXISTS "ix_audit_log_timestamp" ON "audit_log"("timestamp");

-- AddForeignKey group_permissions -> groups (guarded by pg_constraint)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_permissions_group_id_fkey') THEN
    ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_permissions_permission_id_fkey') THEN
    ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey admin_groups -> admins, groups
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_groups_admin_id_fkey') THEN
    ALTER TABLE "admin_groups" ADD CONSTRAINT "admin_groups_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_groups_group_id_fkey') THEN
    ALTER TABLE "admin_groups" ADD CONSTRAINT "admin_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey admin_permission_overrides -> admins, permissions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_permission_overrides_admin_id_fkey') THEN
    ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_permission_overrides_permission_id_fkey') THEN
    ALTER TABLE "admin_permission_overrides" ADD CONSTRAINT "admin_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
