import { prisma } from '@/lib/prisma';

/** Batch-loads admin usernames for actor ids in one query; missing admins stay absent. */
export async function loadActorNames(actorIds: readonly number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  const unique = [...new Set(actorIds)];
  if (unique.length === 0) return names;
  const rows = await prisma.admins.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true },
  });
  for (const row of rows) names.set(row.id, row.username);
  return names;
}
