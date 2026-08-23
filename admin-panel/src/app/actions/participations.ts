'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect } from '@/lib/prisma-selects';
import {
  executeParticipationUpdate,
  parseIpAllowlist,
  queryParticipationDetails,
  type ParticipationDetails,
  type UpdateParticipationInput,
} from './participation-sql';

const PLAINTEXT_PREFIX = 'plaintext:';

interface ActionResult {
  success: boolean;
  error?: string;
}

export async function getParticipation(participationId: number) {
  await ensurePermission('contests');
  return prisma.participations.findUnique({
    where: { id: participationId },
    include: {
      users: { select: safeUserSelect },
      contests: true,
      submissions: { orderBy: { timestamp: 'desc' }, take: 10 },
      messages: { orderBy: { timestamp: 'desc' } },
      questions: { orderBy: { question_timestamp: 'desc' } },
    }
  });
}

export async function updateParticipation(
  participationId: number,
  data: UpdateParticipationInput
): Promise<ActionResult> {
  await ensurePermission('contests');

  try {
    const { validIps, error } = parseIpAllowlist(data.ip);
    if (error) return { success: false, error };

    await executeParticipationUpdate(participationId, data, validIps);

    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    console.error('Failed to update participation:', e);
    return { success: false, error: e.message };
  }
}

export async function setTestUser(participationId: number): Promise<ActionResult> {
  await ensurePermission('contests');

  try {
    await prisma.participations.update({
      where: { id: participationId },
      data: {
        hidden: true,
        unrestricted: true,
      },
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function resolveNewTeamUserIds(contestId: number, teamId: number): Promise<{ allUserIds: number[]; newIds: number[] }> {
  const teamParticipations = await prisma.participations.findMany({
    where: { team_id: teamId },
    select: { user_id: true },
  });
  const allUserIds = [...new Set(teamParticipations.map((p) => p.user_id))];

  const existingParticipations = await prisma.participations.findMany({
    where: { contest_id: contestId, user_id: { in: allUserIds } },
    select: { user_id: true },
  });
  const existingUserIds = new Set(existingParticipations.map((p) => p.user_id));

  return { allUserIds, newIds: allUserIds.filter(id => !existingUserIds.has(id)) };
}

export async function addTeamToContest(
  contestId: number,
  teamId: number,
  options: { hidden?: boolean; unrestricted?: boolean } = {}
): Promise<ActionResult & { added?: number }> {
  await ensurePermission('contests');

  try {
    const { allUserIds, newIds } = await resolveNewTeamUserIds(contestId, teamId);
    if (allUserIds.length === 0) {
      return { success: false, error: 'No users are associated with this team' };
    }
    if (newIds.length === 0) {
      return { success: false, error: 'All team members are already in this contest' };
    }

    const hidden = options.hidden ?? false;
    const unrestricted = options.unrestricted ?? false;

    for (const userId of newIds) {
      await prisma.$executeRaw`
        INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
        VALUES (${contestId}, ${userId}, ${teamId}, ${hidden}, ${unrestricted}, '0 seconds'::interval, '0 seconds'::interval)
      `;
    }

    revalidatePath('/[locale]/contests', 'page');
    return { success: true, added: newIds.length };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getParticipationDetails(id: number): Promise<ParticipationDetails | null> {
  await ensurePermission('contests');
  const p = await queryParticipationDetails(id);
  if (!p) return null;

  return {
    id: p.id,
    contest_id: p.contest_id,
    user_id: p.user_id,
    team_id: p.team_id,
    hidden: p.hidden,
    unrestricted: p.unrestricted,
    delay_time_seconds: p.delay_time_seconds || 0,
    extra_time_seconds: p.extra_time_seconds || 0,
    starting_time: p.starting_time ? new Date(p.starting_time).toISOString().slice(0, 16) : '',
    ip_string: p.ip_string || '',
  };
}

export async function revealParticipationPassword(participationId: number): Promise<
  { success: true; kind: 'plaintext'; value: string } | { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('contests');
  try {
    const row = await prisma.participations.findUnique({ where: { id: participationId }, select: { password: true } });
    const stored = row?.password;
    if (!stored) return { success: true, kind: 'plaintext', value: '' };
    if (stored.startsWith(PLAINTEXT_PREFIX)) return { success: true, kind: 'plaintext', value: stored.slice(PLAINTEXT_PREFIX.length) };
    return { success: true, kind: 'bcrypt' };
  } catch {
    return { success: false, error: 'Unable to load password' };
  }
}

export async function sendMessage(participationId: number, adminId: number, data: {
  subject: string;
  text: string;
}): Promise<ActionResult> {
  await ensurePermission('messaging');

  try {
    await prisma.messages.create({
      data: {
        participation_id: participationId,
        admin_id: adminId,
        subject: data.subject,
        text: data.text,
        timestamp: new Date(),
      }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getMessages(participationId: number) {
  await ensurePermission('contests');
  return prisma.messages.findMany({
    where: { participation_id: participationId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}
