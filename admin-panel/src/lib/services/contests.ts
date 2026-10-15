import { prisma } from '@/lib/prisma';
import { requirePermission, ACTION_PERMISSIONS } from '@/lib/server/authorization';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { validateContestData, CONTEST_NAME_MESSAGE, CONTEST_NAME_REGEX } from '@/lib/contest-validation';
import { recordAudit } from '@/lib/audit';
import { writeActiveContestId } from '@/lib/active-contest';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { readContestWebServerShard, resolveContestBinding, CONTEST_WEB_SERVER_SHARD_KEY, type ContestBinding } from '@/lib/contest-binding';
import { resyncRankingUsers } from '@/lib/ranking-projection';
import {
  fetchContestsPage,
  buildContestInsertDefaults,
  insertContestRow,
  executeContestUpdate,
  mapContestDbError,
} from '@/lib/contests-repo';
import type { ContestData } from '@/lib/contests-repo';
import type { ListSortInput } from '@/lib/list-sorting';

export type { ContestData } from '@/lib/contests-repo';

type ContestListParams = { page?: number; search?: string; sort?: ListSortInput };
type ContestListResult = Awaited<ReturnType<typeof fetchContestsPage>>;
type MutationResult = { success: boolean; error?: string; errors?: Array<{ field: string; message: string; code: string }> };
type AvailableResult = { success: boolean; contests: Array<{ id: number; name: string; is_active: boolean }>; error?: string };
type BoundContestResult = { success: boolean; binding?: ContestBinding; error?: string };

export async function listContests(params: ContestListParams = {}): Promise<ContestListResult> {
  await requirePermission('contest:list');
  return fetchContestsPage(params);
}

export async function createContest(data: ContestData): Promise<MutationResult> {
  const perms = await requirePermission(ACTION_PERMISSIONS.createContest);
  const allowed = stripDisallowedFields('contests', data as unknown as Record<string, unknown>, perms) as unknown as ContestData;
  const rawName = (data as unknown as Record<string, unknown>).name;
  if (typeof rawName !== 'string' || !CONTEST_NAME_REGEX.test(rawName)) {
    return {
      success: false,
      error: CONTEST_NAME_MESSAGE,
      errors: [
        {
          field: 'name',
          message: CONTEST_NAME_MESSAGE,
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
  const perms = await requirePermission(ACTION_PERMISSIONS.updateContest);
  const allowed = stripDisallowedFields('contests', data as unknown as Record<string, unknown>, perms) as unknown as Partial<ContestData>;
  const validation = validateContestData(allowed as ContestData);
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
  await requirePermission(ACTION_PERMISSIONS.deleteContest);
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
  await requirePermission(ACTION_PERMISSIONS.addParticipant);
  try {
    await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
      ON CONFLICT (contest_id, user_id) DO NOTHING
    `;
    await resyncRankingUsers(contestId);
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
  await requirePermission(ACTION_PERMISSIONS.removeParticipant);
  const beforeRow = await prisma.participations.findUnique({ where: { id: participationId } });
  try {
    await prisma.participations.delete({ where: { id: participationId } });
    if (beforeRow !== null) await resyncRankingUsers(beforeRow.contest_id);
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
    const existing = await prisma.contest_tasks.findUnique({
      where: { contest_id_task_id: { contest_id: contestId, task_id: taskId } },
    });
    if (!existing) {
      const aggregate = await prisma.contest_tasks.aggregate({ where: { contest_id: contestId }, _max: { num: true } });
      await prisma.contest_tasks.create({
        data: { contest_id: contestId, task_id: taskId, num: (aggregate._max.num ?? 0) + 1 },
      });
    }
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

export async function removeTaskFromContest(contestId: number, taskId: number): Promise<MutationResult> {
  await requirePermission('task:update');
  try {
    await prisma.contest_tasks.deleteMany({ where: { contest_id: contestId, task_id: taskId } });
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

// Why read-then-write: executeContestUpdate writes the four token and limit
// columns unconditionally, so a window-only patch would null them on every
// selected contest; the current values ride along so a window edit keeps them.
export async function updateContestWindow(id: number, patch: Partial<ContestData>): Promise<MutationResult> {
  await requirePermission(ACTION_PERMISSIONS.updateContest);
  const current = await prisma.contests.findUnique({
    where: { id },
    select: { token_max_number: true, token_gen_max: true, max_submission_number: true, max_user_test_number: true },
  });
  if (current === null) return { success: false, error: 'Contest not found' };
  return updateContest(id, { ...current, ...patch });
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

/**
 * The contest the deployment's contest web server serves, resolved from the registry the way the
 * server resolves it for itself. It opens config.toml itself, so it carries the gate the audited
 * reader demands for that file (env:read + env:list) and leaves the same config:view row.
 */
export async function getBoundContestId(): Promise<BoundContestResult> {
  await requirePermission('contest:list');
  await requirePermission('env:read');
  await requirePermission('env:list');
  try {
    const binding = await resolveContestBinding(await readContestWebServerShard());
    // WHY the match travels with the row: a declared shard that names no registry row leaves the
    // enabled rows' own answer, so the row that answered is how a config.toml and a registry that
    // disagree about the shard become visible at all.
    await recordAudit({ verb: 'config:view', entity: 'config', afterValues: { file: CONFIG_TOML_FILE, requestedKeys: [`contest.${CONTEST_WEB_SERVER_SHARD_KEY}`], bindingMatchedBy: binding.matchedBy }, result: 'success' });
    return { success: true, binding };
  } catch (error: unknown) {
    await recordAudit({ verb: 'config:view', entity: 'config', afterValues: { file: CONFIG_TOML_FILE, error: error instanceof Error ? error.name : 'UnknownError' }, result: 'failure' });
    return { success: false, error: (error as Error).message };
  }
}

export async function activateContest(id: number): Promise<MutationResult> {
  await requirePermission('contest:switch');
  try {
    await writeActiveContestId(id);
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
