-- Add missing permissions columns to 'admins' table
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_tasks BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_users BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_contests BOOLEAN NOT NULL DEFAULT false;

-- Update existing admins to have the new permission columns set
-- Use 'make new-admin' to create admin accounts
