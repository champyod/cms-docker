import { prisma } from '@/lib/prisma';

// The deployment's default contest: contests.is_active, and nothing more. A service registry row
// names the contest one instance serves and outranks it (cms.db.contest_binding reads that row
// per call), so this flag decides what an instance no row names serves. config.toml [contest]
// CONTEST_ID is not derived from it — nothing derives it — so this module neither reads nor writes
// the file, and is the panel's only accessor of the flag.
export const CONTEST_ID_KEY = 'CONTEST_ID';

/**
 * The id of the contest flagged active, or null when no row is. Read from the database
 * because that is the only store that authors it.
 */
export async function readActiveContestId(): Promise<number | null> {
  const contest = await prisma.contests.findFirst({
    where: { is_active: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return contest === null ? null : contest.id;
}

/**
 * Flags exactly `id` active in one transaction: the other rows are cleared before `id` is flagged,
 * so the table can never hold two active contests. The EXISTS guard makes an id that matches no row
 * a no-op instead of clearing the active one; a zero-row flag is fatal.
 *
 * WHY two statements and not one assignment: the partial unique index on is_active
 * (contests_single_active_key) is checked as each updated row reaches the index, so a single
 * statement that clears one row and flags another can meet it with both of them still true — the
 * order rows are visited decides whether it succeeds. Clearing first makes the order irrelevant.
 */
export async function writeActiveContestId(id: number): Promise<void> {
  const [, flagged] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE contests SET is_active = false
      WHERE is_active AND id <> ${id}
        AND EXISTS (SELECT 1 FROM contests WHERE id = ${id})`,
    prisma.$executeRaw`
      UPDATE contests SET is_active = true WHERE id = ${id}`,
  ]);
  if (flagged === 0) {
    throw new Error(`No contest with id ${id} — refusing to clear the active contest`);
  }
}
