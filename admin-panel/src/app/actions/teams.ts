'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect } from '@/lib/prisma-selects';

// Get all teams
export async function getTeams() {
  await ensurePermission('users');

  return prisma.teams.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      organization: true,
      leader: { select: { username: true, first_name: true, last_name: true } },
      _count: { select: { participations: true } },
    },
    orderBy: { name: 'asc' }
  });
}

// Create a team
export async function createTeam(data: { code: string; name: string }) {
  await ensurePermission('users');

  try {
    await prisma.teams.create({
      data: {
        code: data.code,
        name: data.name,
      }
    });
    revalidatePath('/[locale]/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Team code already exists' };
    }
    return { success: false, error: e.message };
  }
}

// Update a team
export async function updateTeam(teamId: number, data: { code?: string; name?: string }) {
  await ensurePermission('users');

  try {
    await prisma.teams.update({
      where: { id: teamId },
      data: {
        ...(data.code && { code: data.code }),
        ...(data.name && { name: data.name }),
      }
    });
    revalidatePath('/[locale]/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete a team
export async function deleteTeam(teamId: number) {
  await ensurePermission('users');

  try {
    await prisma.teams.delete({ where: { id: teamId } });
    revalidatePath('/[locale]/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Get a single team with members and contests
export async function getTeamWithDetails(teamId: number) {
  await ensurePermission('users');

  const team = await prisma.teams.findUnique({
    where: { id: teamId },
    include: {
      participations: {
        include: {
          users: { select: safeUserSelect },
          contests: {
            select: { id: true, name: true, description: true, start: true, stop: true }
          }
        }
      }
    }
  });

  if (!team) return null;

  // Extract unique members (users)
  const membersMap = new Map<number, { user: typeof team.participations[0]['users']; contests: { id: number; name: string }[] }>();

  team.participations.forEach((p: (typeof team.participations)[number]) => {
    if (!membersMap.has(p.user_id)) {
      membersMap.set(p.user_id, { user: p.users, contests: [] });
    }
    membersMap.get(p.user_id)!.contests.push({ id: p.contests.id, name: p.contests.name });
  });

  // Extract unique contests
  const contestsMap = new Map<number, { id: number; name: string; description: string; start: Date; stop: Date }>();
  team.participations.forEach((p: (typeof team.participations)[number]) => {
    if (!contestsMap.has(p.contest_id)) {
      contestsMap.set(p.contest_id, {
        id: p.contests.id,
        name: p.contests.name,
        description: p.contests.description,
        start: p.contests.start,
        stop: p.contests.stop,
      });
    }
  });

  return {
    id: team.id,
    code: team.code,
    name: team.name,
    members: Array.from(membersMap.values()),
    contests: Array.from(contestsMap.values()),
  };
}

