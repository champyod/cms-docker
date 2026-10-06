import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import {
  extractQueuedIds,
  groupByLane,
  parseLanePayload,
  type LaneAssignment,
} from './evaluation-lanes-format';
import type { LaneBoard } from './evaluationLanes';

/** Why capped: lane state lives only in audit rows, so an uncapped scan grows with
 * lifetime history. The board is a working view of the current queue, and the
 * newest rows are the only ones that can still be current. */
const LANE_AUDIT_SCAN_LIMIT = 2000;
const QUEUE_STATUS_RPC_ENDPOINT = 'http://cms-admin-web-server:25000/rpc/EvaluationService/0/queue_status';
const QUEUE_RPC_TIMEOUT_MS = 5000;
const LANE_VERBS: readonly string[] = ['evaluation:lane_assign', 'evaluation:lane_move'];

export async function getLaneBoard(): Promise<LaneBoard> {
  await ensurePermission('evaluation:list');
  const assignments = await readLatestLaneAssignments();
  // Why early return: with no assignments no waiting counts are needed, so an
  // empty board is served without paying for an RPC round trip.
  if (assignments.length === 0) {
    return { lanes: [], waitingSource: 'database' };
  }
  const submissions = await prisma.submissions.findMany({
    where: { id: { in: assignments.map((assignment) => assignment.submissionId) } },
    // Why take at the assignment count: ids are unique, so this can never
    // truncate — it pins the query cost to the already-capped assignment list.
    take: assignments.length,
    select: {
      id: true,
      timestamp: true,
      tasks: { select: { name: true } },
      participations: { select: { user_id: true, users: { select: { username: true } } } },
    },
  });
  const queued = await readQueuedSubmissionIds();
  const userIds = [...new Set(submissions.map((submission) => submission.participations.user_id))];
  const waitingByUser = queued === null ? await countPendingByUserDb(userIds) : await countQueuedByUser(queued);
  return { lanes: groupByLane(assignments, submissions, waitingByUser), waitingSource: queued === null ? 'database' : 'rpc' };
}

async function readLatestLaneAssignments(): Promise<LaneAssignment[]> {
  // Why newest-first scan: lanes live only in audit rows, so the latest lane
  // verb per submission is its current lane; invalid payloads are skipped so an
  // older valid row for the same submission can still win.
  const rows = await prisma.audit_log.findMany({
    where: { entity: 'submission', verb: { in: [...LANE_VERBS] } },
    orderBy: { id: 'desc' },
    take: LANE_AUDIT_SCAN_LIMIT,
    select: { entity_id: true, actor_id: true, after_values: true },
  });
  const seen = new Set<number>();
  const assignments: LaneAssignment[] = [];
  for (const row of rows) {
    const submissionId = row.entity_id === null ? NaN : Number(row.entity_id);
    if (!Number.isInteger(submissionId) || seen.has(submissionId)) {
      continue;
    }
    const payload = parseLanePayload(row.after_values);
    if (payload === null) {
      continue;
    }
    seen.add(submissionId);
    assignments.push({ submissionId, lane: payload.lane, reason: payload.reason, assignedBy: row.actor_id });
  }
  return assignments;
}

async function readQueuedSubmissionIds(): Promise<Set<number> | null> {
  // Why POST {}: the admin web server proxies /rpc/<service>/<shard>/<method>
  // with the JSON body as method kwargs, and queue_status takes none.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUEUE_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(QUEUE_STATUS_RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return extractQueuedIds((await response.json()) as unknown);
  } catch {
    // Why null, not throw: the queue is best-effort context, so any RPC or
    // timeout failure drops through to the database pending counts.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function countQueuedByUser(queued: Set<number>): Promise<Map<number, number>> {
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
  // Why none-with-scored: a submission awaits evaluation when no result row
  // carries a real outcome — covering both never-scored rows and rows whose
  // outcome is still null.
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
