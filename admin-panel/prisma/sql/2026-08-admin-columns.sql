-- Additive admin-panel columns. Hand-written because contests/tasks/participations/datasets
-- carry DB-level CHECK constraints that `prisma migrate` diff may drop. Apply manually.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP(3);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(191);
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization VARCHAR(191);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(191);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS organization VARCHAR(191);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_id INTEGER;

ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_leader_id_fkey') THEN
    ALTER TABLE teams
      ADD CONSTRAINT teams_leader_id_fkey
      FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
