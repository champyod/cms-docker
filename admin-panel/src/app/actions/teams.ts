'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { stripDisallowedFields } from '@/lib/field-permissions';
import * as peopleReadModels from '@/lib/people-read-models';
import { recordAudit } from '@/lib/audit';

// Why: on-demand record read — the Team record header fetches its edit payload
// through this wrapper instead of widening the layout's summary read.
export async function getTeamEditData(teamId: number): Promise<Awaited<ReturnType<typeof peopleReadModels.getTeamEditData>>> {
  return peopleReadModels.getTeamEditData(teamId);
}

export async function getTeams() {
  await ensurePermission('team:list');

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

export async function createTeam(data: { code: string; name: string }) {
  await ensurePermission(ACTION_PERMISSIONS.createTeam);
  const perms = await getPermissions();
  const allowed = stripDisallowedFields('teams', data as Record<string, unknown>, perms);

  try {
    const team = await prisma.teams.create({
      data: allowed as { code: string; name: string },
    });
    await recordAudit({
      verb: 'team:create',
      entity: 'team',
      entityId: String(team.id),
      afterValues: allowed,
      result: 'success',
    });
    revalidatePath('/[locale]/people/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Team code already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateTeam(teamId: number, data: { code?: string; name?: string }) {
  await ensurePermission(ACTION_PERMISSIONS.updateTeam);
  const perms = await getPermissions();
  const allowed = stripDisallowedFields('teams', data as Record<string, unknown>, perms);

  try {
    await prisma.teams.update({
      where: { id: teamId },
      data: allowed as { code?: string; name?: string },
    });
    await recordAudit({
      verb: 'team:update',
      entity: 'team',
      entityId: String(teamId),
      afterValues: allowed,
      result: 'success',
    });
    revalidatePath('/[locale]/people/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteTeam(teamId: number) {
  await ensurePermission(ACTION_PERMISSIONS.deleteTeam);

  let beforeValues: unknown = undefined;
  try {
    beforeValues = await prisma.teams.findUnique({ where: { id: teamId } });
  } catch {
    beforeValues = undefined;
  }

  try {
    await prisma.teams.delete({ where: { id: teamId } });
    await recordAudit({
      verb: 'team:delete',
      entity: 'team',
      entityId: String(teamId),
      beforeValues,
      result: 'success',
    });
    revalidatePath('/[locale]/people/teams', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

