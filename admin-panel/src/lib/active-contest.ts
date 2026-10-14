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
 * Flags exactly `id` active in one statement, so every other row is cleared by the same
 * update and the table can never hold two active contests. The EXISTS guard makes an id
 * that matches no row a no-op instead of clearing every row; a zero-row update is fatal.
 */
export async function writeActiveContestId(id: number): Promise<void> {
  const affected = await prisma.$executeRaw`
    UPDATE contests SET is_active = (id = ${id})
    WHERE EXISTS (SELECT 1 FROM contests WHERE id = ${id})`;
  if (affected === 0) {
    throw new Error(`No contest with id ${id} — refusing to clear the active contest`);
  }
}
