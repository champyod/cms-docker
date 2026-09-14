import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getFreshPermissions } from '@/lib/permissions';
import type { PermissionKey } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { validateContestData } from '@/lib/contest-validation';
import { recordAudit } from '@/lib/audit';
import {
  fetchContestsPage,
  buildContestInsertDefaults,
  insertContestRow,
  executeContestUpdate,
  mapContestDbError,
} from '@/lib/contests-repo';
import type { ContestData } from '@/lib/contests-repo';

export type { ContestData } from '@/lib/contests-repo';

type ContestListParams = { page?: number; search?: string };
type ContestListResult = Awaited<ReturnType<typeof fetchContestsPage>>;
type MutationResult = { success: boolean; error?: string; errors?: Array<{ field: string; message: string; code: string }> };
type AvailableResult = { success: boolean; contests: Array<{ id: number; name: string; is_active: boolean }>; error?: string };
type ActiveResult = { success: boolean; contest?: unknown; error?: string };

// Why: permission failure must surface as a thrown error so adapters can map to
// their transport (throw for actions, 401/403 JSON for routes) without duplicating the check.
async function requirePermission(permission: PermissionKey): Promise<ReadonlySet<string>> {
  const session = await getSession();
  if (!session) {
    const error = new Error('Unauthorized') as Error & { status: number };
    error.status = 401;
    throw error;
  }
  const perms = await getFreshPermissions(session.userId);
  if (!perms || !hasEffectivePermission(perms, permission)) {
    const error = new Error(`Unauthorized: Missing ${permission} permission`) as Error & {
      status: number;
      permission: string;
    };
    error.status = 403;
    error.permission = permission;
    throw error;
  }
  return perms;
}

export async function listContests(params: ContestListParams = {}): Promise<ContestListResult> {
  await requirePermission('contest:list');
  return fetchContestsPage(params);
}

export async function createContest(data: ContestData): Promise<MutationResult> {
  const perms = await requirePermission('contest:create');
  const allowed = stripDisallowedFields('contests', data as unknown as Record<string, unknown>, perms) as unknown as ContestData;
  const rawName = (data as unknown as Record<string, unknown>).name;
  const nameRegex = /^[A-Za-z0-9_-]+$/;
  if (typeof rawName !== 'string' || !nameRegex.test(rawName)) {
    return {
      success: false,
      error: 'Contest name must contain only letters, numbers, hyphens and underscores',
      errors: [
        {
          field: 'name',
          message: 'Contest name must contain only letters, numbers, hyphens and underscores',
          code: 'invalid_name',
        },
      ],
    };
  }
  const validation = validateContestData(allowed);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, error: 'Validation failed' };
  }
  try {
    await insertContestRow(allowed, buildContestInsertDefaults(allowed));
    await recordAudit({ verb: 'contest:create', entity: 'contest', afterValues: allowed, result: 'success' });
    return { success: true };
  } catch (error: unknown) {
    return mapContestDbError(error);
  }
}

export async function updateContest(id: number, data: Partial<ContestData>): Promise<MutationResult> {
  const perms = await requirePermission('contest:update');
  const allowed = stripDisallowedFields('contests', data as unknown as Record<string, unknown>, perms) as unknown as Partial<ContestData>;
  const validation = validateContestData(allowed as ContestData, true);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, error: 'Validation failed' };
  }
  try {
    await executeContestUpdate(id, allowed);
    await recordAudit({
      verb: 'contest:update',
      entity: 'contest',
      entityId: String(id),
      afterValues: allowed,
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return mapContestDbError(error);
  }
}

export async function deleteContest(id: number): Promise<MutationResult> {
  await requirePermission('contest:delete');
  const beforeRow = await prisma.contests.findUnique({ where: { id } });
  try {
    await prisma.contests.delete({ where: { id } });
    await recordAudit({
      verb: 'contest:delete',
      entity: 'contest',
      entityId: String(id),
      beforeValues: beforeRow ?? undefined,
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function addParticipant(contestId: number, userId: number): Promise<MutationResult> {
  await requirePermission('participation:create');
  try {
    await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
    `;
    await recordAudit({
      verb: 'participation:create',
      entity: 'participation',
      afterValues: { contestId, userId },
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeParticipant(participationId: number): Promise<MutationResult> {
  await requirePermission('participation:delete');
  const beforeRow = await prisma.participations.findUnique({ where: { id: participationId } });
  try {
    await prisma.participations.delete({ where: { id: participationId } });
    await recordAudit({
      verb: 'participation:delete',
      entity: 'participation',
      entityId: String(participationId),
      beforeValues: beforeRow ?? undefined,
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function addTaskToContest(contestId: number, taskId: number): Promise<MutationResult> {
  await requirePermission('task:update');
  try {
    await prisma.tasks.update({ where: { id: taskId }, data: { contest_id: contestId } });
    await recordAudit({
      verb: 'task:update',
      entity: 'task',
      entityId: String(taskId),
      afterValues: { contest_id: contestId },
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeTaskFromContest(taskId: number): Promise<MutationResult> {
  await requirePermission('task:update');
  try {
    await prisma.tasks.update({ where: { id: taskId }, data: { contest_id: null } });
    await recordAudit({
      verb: 'task:update',
      entity: 'task',
      entityId: String(taskId),
      afterValues: { contest_id: null },
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateContestSettings(id: number, data: Partial<ContestData>): Promise<MutationResult> {
  return updateContest(id, data);
}

export async function getAvailableContests(): Promise<AvailableResult> {
  await requirePermission('contest:list');
  try {
    const contests = await prisma.contests.findMany({
      select: { id: true, name: true, is_active: true },
      orderBy: { id: 'asc' },
    });
    return { success: true, contests };
  } catch (error: unknown) {
    return { success: false, contests: [], error: (error as Error).message };
  }
}

export async function activateContest(id: number): Promise<MutationResult> {
  await requirePermission('contest:switch');
  try {
    await prisma.$executeRaw`UPDATE contests SET is_active = (id = ${id})`;
    await recordAudit({
      verb: 'contest:switch',
      entity: 'contest',
      entityId: String(id),
      afterValues: { is_active: true },
      result: 'success',
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getActiveContest(): Promise<ActiveResult> {
  await requirePermission('contest:read');
  try {
    const contest = await prisma.contests.findFirst({
      where: { is_active: true },
      include: { _count: { select: { participations: true } } },
    });
    return { success: true, contest };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}
