'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get all teams
export async function getTeams() {
  return prisma.teams.findMany({
    include: {
      _count: { select: { participations: true } }
    },
    orderBy: { name: 'asc' }
  });
}

// Create a team
export async function createTeam(data: { code: string; name: string }) {
  try {
    await prisma.teams.create({
      data: {
        code: data.code,
        name: data.name,
      }
    });
    revalidatePath('/[locale]/teams');
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
  try {
    await prisma.teams.update({
      where: { id: teamId },
      data: {
        ...(data.code && { code: data.code }),
        ...(data.name && { name: data.name }),
      }
    });
    revalidatePath('/[locale]/teams');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete a team
export async function deleteTeam(teamId: number) {
  try {
    await prisma.teams.delete({ where: { id: teamId } });
    revalidatePath('/[locale]/teams');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
