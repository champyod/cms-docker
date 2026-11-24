import { prisma } from '@/lib/prisma';

// contests.is_active decides what an instance no registry row names serves; config.toml CONTEST_ID is not derived from it.
export const CONTEST_ID_KEY = 'CONTEST_ID';

/** The id of the contest flagged active, read from the only store that authors it. */
export async function readActiveContestId(): Promise<number | null> {
  const contest = await prisma.contests.findFirst({
    where: { is_active: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return contest === null ? null : contest.id;
}

/** The other rows clear before id is flagged, so the partial unique index never sees two active rows. */
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
    throw new Error(`No contest with id ${id}: refusing to clear the active contest`);
  }
}
