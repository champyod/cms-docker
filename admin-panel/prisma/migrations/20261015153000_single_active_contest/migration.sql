-- 20261015153000_single_active_contest/migration.sql
-- At most one contest may be flagged active. contests.is_active is the deployment's default
-- contest — every reader that finds no service-registry row for an instance lands on it (cms.db's
-- active_contest_id, the config sync, the admin panel's deployments page) — so two active rows
-- make each of them able to pick a different contest. Until now only the two writers kept the
-- table at one row, which leaves the flag free to drift the moment a row is written anywhere else.
--
-- WHY a partial unique index and not a UNIQUE constraint: the restriction covers only the rows
-- where the flag is set ("a uniqueness restriction covering only some rows cannot be written as a
-- unique constraint", PostgreSQL docs 5.5), and a partial index can never be a deferrable
-- constraint. The uniqueness check therefore runs as each updated row reaches the index, which is
-- why both writers clear the other rows before flagging the target: one statement that flips two
-- rows can meet the index with both of them still true, depending on the order rows are visited.
--
-- WHY this fails loudly instead of reconciling a database that already holds two active rows:
-- choosing one here would silently move the contest the deployment serves. Keep the intended row
-- and re-run:  ./cms contest set-active <id>
-- WHY guarded: a rebuilt database re-applies migrations and prod may already carry the index.

DO $$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT count(*) INTO active_count FROM "contests" WHERE "is_active";
  IF active_count > 1 THEN
    RAISE EXCEPTION 'contests holds % rows with is_active — keep one with "./cms contest set-active <id>", then re-run this migration', active_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "contests_single_active_key" ON "contests" ("is_active") WHERE "is_active";
