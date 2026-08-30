import { prisma } from '@/lib/prisma';

/** Finds a team by its code, creating a stub named after the code when absent. */
export async function resolveTeamIdByCode(teamCode: string): Promise<number> {
  const existingTeam = await prisma.teams.findUnique({
    where: { code: teamCode },
    select: { id: true },
  });

  if (existingTeam) return existingTeam.id;

  const created = await prisma.teams.create({ data: { code: teamCode, name: teamCode }, select: { id: true } });
  return created.id;
}
