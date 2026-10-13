import { prisma } from '@/lib/prisma';

// The active contest lives in exactly one place: contests.is_active in the database.
// config.toml [contest] CONTEST_ID and the generated .env are derived from it by
// scripts/__config_sync.sh (see ./cms contest set-active), so neither is a writable copy
// and nothing here reads or writes them. This module is the panel's only accessor of it.
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
