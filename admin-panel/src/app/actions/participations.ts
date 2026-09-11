'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { safeUserSelect } from '@/lib/prisma-selects';
import { recordAudit } from '@/lib/audit';
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
  await ensurePermission('participation:read');
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
  await ensurePermission('participation:update');

  try {
    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('participations', data as Record<string, unknown>, permissions) as UpdateParticipationInput;

    const { validIps, error } = parseIpAllowlist(allowed.ip);
    if (error) return { success: false, error };

    await executeParticipationUpdate(participationId, allowed, validIps);

    {
      const { password: _password, passwordKind: _passwordKind, ip: _ip, ...restAllowed } = allowed as Record<string, unknown>;
      await recordAudit({
        verb: 'participation:update',
        entity: 'participation',
        entityId: String(participationId),
        afterValues: {
          ...restAllowed,
          ...((allowed as { password?: string | null }).password !== undefined ? { passwordChanged: true } : {}),
          ip: validIps,
        },
        result: 'success',
      });
    }
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    console.error('Failed to update participation:', e);
    return { success: false, error: e.message };
  }
}

export async function setTestUser(participationId: number): Promise<ActionResult> {
  await ensurePermission('participation:update');

  try {
    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('participations', { hidden: true, unrestricted: true }, permissions);
    if (allowed.hidden === undefined && allowed.unrestricted === undefined) {
      return { success: false, error: 'Insufficient permissions' };
    }
    await prisma.participations.update({
      where: { id: participationId },
      data: {
        ...(allowed.hidden !== undefined && { hidden: allowed.hidden }),
        ...(allowed.unrestricted !== undefined && { unrestricted: allowed.unrestricted }),
      },
    });
    await recordAudit({
      verb: 'participation:update',
      entity: 'participation',
      entityId: String(participationId),
      afterValues: allowed,
      result: 'success',
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
  await ensurePermission('participation:create');

  try {
    const { allUserIds, newIds } = await resolveNewTeamUserIds(contestId, teamId);
    if (allUserIds.length === 0) {
      return { success: false, error: 'No users are associated with this team' };
    }
    if (newIds.length === 0) {
      return { success: false, error: 'All team members are already in this contest' };
    }

    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('participations', {
      hidden: options.hidden ?? false,
      unrestricted: options.unrestricted ?? false,
    }, permissions);
    const hidden = allowed.hidden ?? false;
    const unrestricted = allowed.unrestricted ?? false;

    for (const userId of newIds) {
      await prisma.$executeRaw`
        INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
        VALUES (${contestId}, ${userId}, ${teamId}, ${hidden}, ${unrestricted}, '0 seconds'::interval, '0 seconds'::interval)
      `;
    }

    await recordAudit({
      verb: 'participation:create',
      entity: 'participation',
      afterValues: { contestId, teamId, added: newIds.length, hidden, unrestricted },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true, added: newIds.length };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getParticipationDetails(id: number): Promise<ParticipationDetails | null> {
  await ensurePermission('participation:read');
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
  await ensurePermission('password:reveal');
  try {
    const row = await prisma.participations.findUnique({ where: { id: participationId }, select: { password: true } });
    const stored = row?.password;
    if (stored === null || stored === undefined) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'participation',
        entityId: String(participationId),
        beforeValues: { participationId },
        afterValues: { kind: 'plaintext' },
        result: 'success',
      });
      return { success: true, kind: 'plaintext', value: '' };
    }
    if (stored.startsWith(PLAINTEXT_PREFIX)) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'participation',
        entityId: String(participationId),
        beforeValues: { participationId },
        afterValues: { kind: 'plaintext' },
        result: 'success',
      });
      return { success: true, kind: 'plaintext', value: stored.slice(PLAINTEXT_PREFIX.length) };
    }
    await recordAudit({
      verb: 'password:reveal',
      entity: 'participation',
      entityId: String(participationId),
      beforeValues: { participationId },
      afterValues: { kind: 'bcrypt' },
      result: 'success',
    });
    return { success: true, kind: 'bcrypt' };
  } catch {
    return { success: false, error: 'Unable to load password' };
  }
}

export async function sendMessage(participationId: number, adminId: number, data: {
  subject: string;
  text: string;
}): Promise<ActionResult> {
  await ensurePermission('message:send');

  try {
    const message = await prisma.messages.create({
      data: {
        participation_id: participationId,
        admin_id: adminId,
        subject: data.subject,
        text: data.text,
        timestamp: new Date(),
      }
    });
    await recordAudit({
      verb: 'message:send',
      entity: 'message',
      entityId: String(message.id),
      afterValues: { participationId, subject: data.subject },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getMessages(participationId: number) {
  await ensurePermission('message:list');
  return prisma.messages.findMany({
    where: { participation_id: participationId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}
