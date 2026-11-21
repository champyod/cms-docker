-- 20261015160000_ranking_hidden/migration.sql
-- A participation the panel hid, projected as a tombstone the scoreboard filters out.
--
-- WHY a table rather than a delete: the board row is driven by ranking_submissions, so
-- dropping the ranking_users row leaves the row on the board and its scores in the
-- ledger. A tombstone is the one shape both writers can reach — the proxy's full push
-- (ProxyService.initialize) and the panel's mirror (ranking-projection.ts) — and the
-- reader folds it into the same hide rule the override rows already use.
--
-- WHY scoped by contest id and not by the encoded contest name ranking_tasks carries:
-- the reader's only contest handle is RANKING_CONTEST_ID, the same CMS contest id
-- ranking_overrides.contest_id holds, so this is the one column the reader can filter
-- on. The primary key is (key, contest_id) because a username may be hidden in one
-- contest and ranked in another.
--
-- WHY it stays out of the backup catalog: the row is derived from participations.hidden,
-- which a restore already carries, so a restored copy would only contradict the rows
-- beside it. tests/backup-table-catalog.test.ts records that exclusion.

-- CreateTable
CREATE TABLE "ranking_hidden" (
    "key" VARCHAR NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_hidden_pkey" PRIMARY KEY ("key","contest_id")
);

-- CreateIndex
CREATE INDEX "ix_ranking_hidden_contest" ON "ranking_hidden"("contest_id");

-- RLS in the shape scripts/__generate_rls_sql.sh emits the guards, because FORCE subjects
-- the cmsuser owner to RLS and a permissive policy must ride along.
-- WHY the role check on the policy alone: the ranking job in CI applies the *_ranking_*
-- migrations to a database that has no cmsuser role, and a CREATE POLICY naming an absent
-- role fails the migration there. The deployment has the role, so it gets the policy.
DO $$ BEGIN
  IF to_regclass('public.ranking_hidden') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.ranking_hidden ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.ranking_hidden FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.ranking_hidden') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cmsuser') THEN
    EXECUTE 'DROP POLICY IF EXISTS cmsuser_all ON public.ranking_hidden';
    EXECUTE 'CREATE POLICY cmsuser_all ON public.ranking_hidden FOR ALL TO cmsuser USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- The same per-row notification the other projection tables carry, from the function
-- 20261009160000_ranking_notify created; the reader maps the table to an entity kind.
CREATE TRIGGER ranking_notify_hidden AFTER INSERT OR UPDATE OR DELETE ON ranking_hidden
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
