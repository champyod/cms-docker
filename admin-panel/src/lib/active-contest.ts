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
 * update and the table can never hold two active contests.
 */
export async function writeActiveContestId(id: number): Promise<void> {
  await prisma.$executeRaw`UPDATE contests SET is_active = (id = ${id})`;
}
