-- The board's contest is named by the config, never by the appearance row.
--
-- WHY the column goes: `ranking_config` is the one thing that says what the board shows, and
-- `ranking_settings.contest_id` was a second, reader-ignored place a contest could be named — so
-- the appearance form offered a control that looked like it picked the board and did not. Leaving
-- the column would keep the second representation this retirement exists to remove.
--
-- The wording override stays, keyed by the contest the config shows: the words are the operator's
-- exception over that contest's own name and dates.
ALTER TABLE "ranking_settings" DROP COLUMN "contest_id";
