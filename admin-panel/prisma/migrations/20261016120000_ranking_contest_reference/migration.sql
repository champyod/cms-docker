-- The board names a contest instead of carrying a copy of its wording.
--
-- WHY a reference and not the text: the settings row held the board's name and dates as free
-- text, so on 2026-10-16 the row still announced day 1 while the board served day 2 and the
-- header lied to every participant. The row now names a contest, and the name and dates are
-- read from that contest's record.
ALTER TABLE "ranking_settings" ADD COLUMN "contest_id" INTEGER;

-- An explicit per-contest wording override, for when the operator wants different words. Keyed
-- by the contest it is for, so switching the named contest falls back to that contest's own
-- name and dates instead of keeping the words of the contest the board no longer serves.
ALTER TABLE "ranking_settings" ADD COLUMN "wording_overrides" JSONB;

-- The projection carries the contest's own id.
--
-- WHY the push had to grow this field: the projected key is the encoded contest *name*, so a
-- reference to a contest cannot be resolved against it once the contest is renamed, and there is
-- nothing else on the row that names which deployment's contest it is. With the id on the row, a
-- reader resolves its own contest by the handle it binds and the id survives a rename.
ALTER TABLE "ranking_contests" ADD COLUMN "contest_id" INTEGER;

CREATE INDEX "ix_ranking_contests_contest_id" ON "ranking_contests"("contest_id");
