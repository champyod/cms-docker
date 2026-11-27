-- 20261122140000_ranking_session_records/migration.sql — server-side ranking console sessions.
-- WHY: the 8-hour bearer token cannot be revoked; a row per session is what logout and every
-- admin credential/permission change can delete, so the next request fails the gate.
CREATE TABLE "ranking_sessions" (
    "session_id" VARCHAR(64) NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "username" VARCHAR NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranking_sessions_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX "ix_ranking_sessions_admin_id" ON "ranking_sessions"("admin_id");
CREATE INDEX "ix_ranking_sessions_expires_at" ON "ranking_sessions"("expires_at");

ALTER TABLE "ranking_sessions" ADD CONSTRAINT "ranking_sessions_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, DELETE ON "ranking_sessions" TO cmsuser;
