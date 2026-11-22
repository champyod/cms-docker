'use server';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { callEvaluationRpc, unwrapRpcEnvelope } from '@/lib/evaluation-rpc';

import {
  listEvaluationWorkers,
  refreshEvaluationWorkers,
  type EvaluationWorkerSummary,
} from './evaluationWorkers';

/** One busy lane must not crowd the others out of the response. */
const MAX_ITEMS_PER_LANE = 200;

const QUEUE_SUBMISSION_TYPES: readonly string[] = ['compile', 'evaluate'];

export interface LaneBoardItem {
  submissionId: number;
  laneId: number | null;
  username: string;
  taskName: string;
  timestamp: string;
  waitingCount: number;
}

export interface LaneBoardLane {
  id: number;
  name: string;
  workerId: number | null;
  workerName: string | null;
  items: LaneBoardItem[];
}

export interface LaneBoard {
  lanes: LaneBoardLane[];
  /**
   * Submissions in no lane. Always present as a column: it is the bucket a new submission
   * lands in and the destination when a lane is cleared, so the board never has an
   * invisible place for work to sit.
   */
  unassigned: LaneBoardItem[];
  unassignedTotal: number;
  workers: EvaluationWorkerSummary[];
  waitingSource: 'rpc' | 'database';
}

type BoardSubmission = Prisma.submissionsGetPayload<{
  select: {
    id: true;
    lane_id: true;
    timestamp: true;
    tasks: { select: { name: true } };
    participations: { select: { user_id: true; users: { select: { username: true } } } };
  };
}>;

const BOARD_SUBMISSION_SELECT = {
  id: true,
  lane_id: true,
  timestamp: true,
  tasks: { select: { name: true } },
  participations: { select: { user_id: true, users: { select: { username: true } } } },
} as const;

/** The submission ids the evaluator queue is holding, or null when it did not answer. */
async function readQueuedSubmissionIds(): Promise<Set<number> | null> {
  const data = unwrapRpcEnvelope(await callEvaluationRpc('queue_status'));
  if (!Array.isArray(data)) {
    return null;
  }

  const ids = new Set<number>();
  for (const entry of data as unknown[]) {
    const item = (entry as { item?: unknown } | null)?.item;
    if (typeof item !== 'object' || item === null) continue;
    const { type, object_id: objectId } = item as { type?: unknown; object_id?: unknown };
    // Why only submission ops: user-test entries share the queue but belong to no
    // submission, so they must not inflate any submitter's waiting count.
    if (!Number.isInteger(objectId) || typeof type !== 'string') continue;
    if (!QUEUE_SUBMISSION_TYPES.includes(type)) continue;
    ids.add(objectId as number);
  }
  return ids;
}

async function countQueuedByUser(queued: ReadonlySet<number>): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (queued.size === 0) {
    return counts;
  }
  const rows = await prisma.submissions.findMany({
    where: { id: { in: [...queued] } },
    select: { participations: { select: { user_id: true } } },
  });
  for (const row of rows) {
    const userId = row.participations.user_id;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }
  return counts;
}

async function countPendingByUserDb(userIds: readonly number[]): Promise<Map<number, number>> {
  // Why none-with-scored: a submission awaits evaluation when no result row carries a real
  // outcome — covering both never-scored rows and rows whose outcome is still null.
  const entries = await Promise.all(
    userIds.map(async (userId): Promise<[number, number]> => {
      const count = await prisma.submissions.count({
        where: {
          participations: { user_id: userId },
          submission_results: { none: { NOT: { evaluation_outcome: null } } },
        },
      });
      return [userId, count];
    }),
  );
  return new Map(entries);
}

function toBoardItem(submission: BoardSubmission, waitingByUser: ReadonlyMap<number, number>): LaneBoardItem {
  return {
    submissionId: submission.id,
    laneId: submission.lane_id,
    username: submission.participations.users.username,
    taskName: submission.tasks.name,
    timestamp: submission.timestamp.toISOString(),
    waitingCount: waitingByUser.get(submission.participations.user_id) ?? 0,
  };
}

/** Waiting counts per submission owner, preferring the live queue and falling back to the DB. */
async function readWaitingByUser(
  submissions: readonly BoardSubmission[],
): Promise<{ counts: Map<number, number>; source: 'rpc' | 'database' }> {
  const queued = await readQueuedSubmissionIds();
  if (queued !== null) {
    return { counts: await countQueuedByUser(queued), source: 'rpc' };
  }
  const userIds = [...new Set(submissions.map((submission) => submission.participations.user_id))];
  return { counts: await countPendingByUserDb(userIds), source: 'database' };
}

/**
 * The lane board: every lane in display order, plus the unassigned bucket and the workers.
 *
 * WHY the worker refresh is swallowed: it is a projection of the generated config and a live
 * probe, so a failure there must degrade the worker labels, never the board itself.
 */
export async function getLaneBoard(): Promise<LaneBoard> {
  await ensurePermission('evaluation:list');

  try {
    await refreshEvaluationWorkers();
  } catch {
    // Worker labels below degrade to whatever the registry already holds.
  }

  const [lanes, workers] = await Promise.all([
    prisma.evaluation_lanes.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, worker_id: true, evaluation_workers: { select: { id: true, name: true } } },
    }),
    listEvaluationWorkers(),
  ]);

  const laneIds = lanes.map((lane) => lane.id);
  const [assigned, unassignedTotal] = await Promise.all([
    prisma.submissions.findMany({
      where: { lane_id: { in: laneIds } },
      orderBy: { id: 'desc' },
      take: MAX_ITEMS_PER_LANE * Math.max(laneIds.length, 1),
      select: BOARD_SUBMISSION_SELECT,
    }),
    prisma.submissions.count({ where: { lane_id: null } }),
  ]);

  const unassignedRows = await prisma.submissions.findMany({
    where: { lane_id: null },
    orderBy: { id: 'desc' },
    take: MAX_ITEMS_PER_LANE,
    select: BOARD_SUBMISSION_SELECT,
  });

  const waiting = await readWaitingByUser([...assigned, ...unassignedRows]);

  const byLane = new Map<number, LaneBoardItem[]>();
  for (const submission of assigned) {
    if (submission.lane_id === null) continue;
    const items = byLane.get(submission.lane_id) ?? [];
    if (items.length < MAX_ITEMS_PER_LANE) {
      items.push(toBoardItem(submission, waiting.counts));
      byLane.set(submission.lane_id, items);
    }
  }

  return {
    lanes: lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      workerId: lane.worker_id,
      workerName: lane.evaluation_workers?.name ?? null,
      items: byLane.get(lane.id) ?? [],
    })),
    unassigned: unassignedRows.map((submission) => toBoardItem(submission, waiting.counts)),
    unassignedTotal,
    workers,
    waitingSource: waiting.source,
  };
}
