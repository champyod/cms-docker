-- Drop dead permission_* boolean columns from admins (data preserved in admin_groups backfill)
ALTER TABLE "admins" DROP COLUMN "permission_all";
ALTER TABLE "admins" DROP COLUMN "permission_messaging";
ALTER TABLE "admins" DROP COLUMN "permission_tasks";
ALTER TABLE "admins" DROP COLUMN "permission_users";
ALTER TABLE "admins" DROP COLUMN "permission_contests";
