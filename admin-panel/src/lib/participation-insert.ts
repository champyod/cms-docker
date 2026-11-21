import { prisma } from '@/lib/prisma';

/**
 * Inserts a participation; a validated allowlist rides the same cidr cast on every path.
 *
 * Why shared: bulk-create and batch contest-add must not drift into two column lists.
 */
export async function insertParticipation(
  contestId: number,
  userId: number,
  teamId: number | null,
  validIps: readonly string[],
): Promise<number> {
  const hasIps = validIps.length > 0;
  const base = validIps.length;
  const ipColumn = hasIps ? ', ip' : '';
  const ipValue = hasIps
    ? `, ARRAY[${validIps.map((_, index) => `$${index + 1}::cidr`).join(', ')}]`
    : '';

  return prisma.$executeRawUnsafe(
    `INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time${ipColumn})
     VALUES ($${base + 1}, $${base + 2}, $${base + 3}, false, false, '0 seconds'::interval, '0 seconds'::interval${ipValue})
     ON CONFLICT (contest_id, user_id) DO NOTHING`,
    ...validIps,
    contestId,
    userId,
    teamId,
  );
}
