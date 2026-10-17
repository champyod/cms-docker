import type { Prisma } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

/**
 * The write side of a contest's task roster: which tasks a contest serves.
 *
 * WHY one module: the panel's single-row add/remove and the contest-task surface's bulk
 * attach/detach have to mean the same thing by "a task is on this contest" — the same next-number
 * rule, the same one-row-per-pair shape — so the membership write lives here once and both
 * boundaries call it. Nothing here reads a request, so the same functions run in-process.
 *
 * WHY the refusals are named and not skips: a task that does not exist, a contest the panel cannot
 * read and a task already on the contest are targets the caller named that this cannot act on. A
 * batch that quietly wrote the rest would report a roster change that never covered every row, so
 * each of these stops the whole write with the row it names.
 */

/** One contest's task selection, as the bulk surface states it. */
export interface ContestTaskSelection {
  readonly contestId: number;
  readonly taskIds: readonly number[];
}

function readContestId(raw: number): number {
  if (!Number.isInteger(raw) || raw <= 0) throw new Error(`not a contest id: ${String(raw)}`);
  return raw;
}

function readTaskIds(raw: readonly number[]): number[] {
  const refused = raw.filter((id) => !Number.isInteger(id) || id <= 0);
  if (refused.length > 0) throw new Error(`not a task id: ${refused.join(', ')}`);
  if (raw.length === 0) throw new Error('select at least one task');
  return [...new Set(raw)];
}

/** The contest a task roster belongs to, or a refusal naming the id the caller stated. */
async function requireContest(contestId: number): Promise<void> {
  const contest = await prisma.contests.findUnique({ where: { id: contestId }, select: { id: true } });
  if (contest === null) throw new Error(`no contest with id ${contestId}`);
}

/** Every named task, refusing the ids the database does not carry. */
async function requireTasks(taskIds: readonly number[]): Promise<void> {
  const rows = await prisma.tasks.findMany({ where: { id: { in: [...taskIds] } }, select: { id: true } });
  const found = new Set(rows.map((row) => row.id));
  const missing = taskIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`no task with id ${missing.join(', ')}`);
}

/**
 * Adds one task to a contest, taking the next free number when the pair is new.
 *
 * WHY the read-then-write: `num` orders the contest's tasks and is unique per contest, so the
 * insert has to read the current maximum to pick the next one. The bulk path runs these in order
 * inside one transaction so each insert sees the number the previous one just took.
 *
 * returns: whether the pair was created (false when the task was already on the contest).
 */
export async function attachContestTask(
  client: Prisma.TransactionClient,
  contestId: number,
  taskId: number,
): Promise<boolean> {
  const existing = await client.contest_tasks.findUnique({
    where: { contest_id_task_id: { contest_id: contestId, task_id: taskId } },
  });
  if (existing !== null) return false;
  const aggregate = await client.contest_tasks.aggregate({
    where: { contest_id: contestId },
    _max: { num: true },
  });
  await client.contest_tasks.create({
    data: { contest_id: contestId, task_id: taskId, num: (aggregate._max.num ?? 0) + 1 },
  });
  return true;
}

/**
 * Removes one task from a contest.
 *
 * returns: whether a row was removed (false when the task was not on the contest).
 */
export async function detachContestTask(
  client: Prisma.TransactionClient,
  contestId: number,
  taskId: number,
): Promise<boolean> {
  const { count } = await client.contest_tasks.deleteMany({
    where: { contest_id: contestId, task_id: taskId },
  });
  return count > 0;
}

/**
 * Puts every selected task on the contest in one transaction, or refuses the whole selection.
 *
 * WHY a task already on the contest is a refusal and not a skip: the operator selected that row, so
 * reporting the batch as applied would claim a change the row did not get — the same silent skip
 * the panel refuses everywhere else.
 *
 * returns: how many memberships were created.
 */
export async function attachContestTasks(
  actorId: number,
  selection: ContestTaskSelection,
): Promise<number> {
  const contestId = readContestId(selection.contestId);
  const taskIds = readTaskIds(selection.taskIds);
  await requireContest(contestId);
  await requireTasks(taskIds);

  const already = await prisma.contest_tasks.findMany({
    where: { contest_id: contestId, task_id: { in: taskIds } },
    select: { task_id: true },
  });
  if (already.length > 0) {
    throw new Error(`already on contest ${contestId}: ${already.map((row) => row.task_id).join(', ')}`);
  }

  const attached = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const taskId of taskIds) {
      if (await attachContestTask(tx, contestId, taskId)) count += 1;
    }
    return count;
  });

  await recordAudit({
    actorId,
    verb: 'task:update',
    entity: 'contest',
    entityId: String(contestId),
    afterValues: { action: 'contest-task-attach', contestId, taskIds, attached },
    result: 'success',
  });
  return attached;
}

/**
 * Takes every selected task off the contest in one transaction, or refuses the whole selection.
 *
 * WHY a task not on the contest is a refusal: the selection names rows, and removing the subset that
 * happened to be present would report a detach that covered fewer rows than the operator selected.
 *
 * returns: how many memberships were removed.
 */
export async function detachContestTasks(
  actorId: number,
  selection: ContestTaskSelection,
): Promise<number> {
  const contestId = readContestId(selection.contestId);
  const taskIds = readTaskIds(selection.taskIds);
  await requireContest(contestId);

  const present = await prisma.contest_tasks.findMany({
    where: { contest_id: contestId, task_id: { in: taskIds } },
    select: { task_id: true },
  });
  const found = new Set(present.map((row) => row.task_id));
  const missing = taskIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`not on contest ${contestId}: ${missing.join(', ')}`);
  }

  const detached = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const taskId of taskIds) {
      if (await detachContestTask(tx, contestId, taskId)) count += 1;
    }
    return count;
  });

  await recordAudit({
    actorId,
    verb: 'task:update',
    entity: 'contest',
    entityId: String(contestId),
    afterValues: { action: 'contest-task-detach', contestId, taskIds, detached },
    result: 'success',
  });
  return detached;
}
