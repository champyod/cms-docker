import { prisma } from '@/lib/prisma';

export async function resolveTeamIdByCode(teamCode: string): Promise<number> {
  const existingTeam = await prisma.teams.findUnique({
    where: { code: teamCode },
    select: { id: true },
  });

  if (existingTeam) return existingTeam.id;

  const created = await prisma.teams.create({ data: { code: teamCode, name: teamCode }, select: { id: true } });
  return created.id;
}
