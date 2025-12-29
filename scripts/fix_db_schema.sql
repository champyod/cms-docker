-- Add missing permissions columns to 'admins' table
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_tasks BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_users BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_contests BOOLEAN NOT NULL DEFAULT false;

-- Create or update default admin 'admin' with all permissions
INSERT INTO admins (name, username, authentication, enabled, permission_all, permission_messaging, permission_tasks, permission_users, permission_contests)
VALUES ('Super Admin', 'admin', 'password:admin', true, true, true, true, true, true)
ON CONFLICT (username) DO UPDATE 
SET permission_tasks = true, permission_users = true, permission_contests = true;
