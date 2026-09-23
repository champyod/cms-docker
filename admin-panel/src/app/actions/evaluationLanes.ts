'use server'

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';

const MAX_LANE_NAME_LENGTH = 64;
const MAX_REASON_LENGTH = 500;

interface ActionResult {
  success: boolean;
  error?: string;
  field?: 'reason' | 'lane' | 'submissionId' | 'contestId';
}

function validateReasonInput(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return 'Reason must not be empty';
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    return `Reason must be at most ${MAX_REASON_LENGTH} characters`;
  }
  return null;
}

function validateLaneInput(submissionId: number, lane: string): string | null {
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return 'Invalid submission id';
  }
  const trimmed = lane.trim();
  if (trimmed.length === 0) {
    return 'Lane must not be empty';
  }
  if (trimmed.length > MAX_LANE_NAME_LENGTH) {
    return `Lane must be at most ${MAX_LANE_NAME_LENGTH} characters`;
  }
  return null;
}

export async function assignEvaluationLane(submissionId: number, lane: string, reason: string): Promise<ActionResult> {
  await ensurePermission('evaluation:lane_assign');

  const reasonError = validateReasonInput(reason);
  if (reasonError) {
    return { success: false, error: reasonError, field: 'reason' };
  }

  const validationError = validateLaneInput(submissionId, lane);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    // Why: no dedicated lane column exists, so the assignment is recorded in the
    // tamper-evident audit log until lane persistence lands.
    await recordAudit({
      verb: 'evaluation:lane_assign',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { lane: lane.trim(), reason: reason.trim(), assignedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/submissions');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function moveEvaluationLane(submissionId: number, lane: string, reason: string): Promise<ActionResult> {
  await ensurePermission('evaluation:lane_move');

  const reasonError = validateReasonInput(reason);
  if (reasonError) {
    return { success: false, error: reasonError, field: 'reason' };
  }

  const validationError = validateLaneInput(submissionId, lane);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    // Why: no dedicated lane column exists, so the move is recorded in the
    // tamper-evident audit log until lane persistence lands.
    await recordAudit({
      verb: 'evaluation:lane_move',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { lane: lane.trim(), reason: reason.trim(), movedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/submissions');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function setFinalOpen(contestId: number, open: boolean, reason: string): Promise<ActionResult> {
  await ensurePermission('contest:update');

  const reasonError = validateReasonInput(reason);
  if (reasonError) {
    return { success: false, error: reasonError, field: 'reason' };
  }

  if (!Number.isInteger(contestId) || contestId <= 0) {
    return { success: false, error: 'Invalid contest id' };
  }

  try {
    const contest = await prisma.contests.findUnique({
      where: { id: contestId },
      select: { id: true },
    });
    if (!contest) {
      return { success: false, error: 'Contest not found' };
    }

    // Why raw SQL: the throttle columns are not in the generated client yet,
    // so the typed update cannot set them.
    const stampedAt = open ? new Date() : null;
    await prisma.$executeRaw`
      UPDATE contests
      SET evaluation_final_open = ${open}, evaluation_final_open_at = ${stampedAt}
      WHERE id = ${contestId}
    `;

    await recordAudit({
      verb: 'contest:update',
      entity: 'contest',
      entityId: String(contestId),
      afterValues: { evaluation_final_open: open, reason: reason.trim(), openedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

const QUEUE_STATUS_RPC_ENDPOINT = 'http://cms-admin-web-server:25000/rpc/EvaluationService/0/queue_status';
const QUEUE_RPC_TIMEOUT_MS = 5000;
const QUEUE_SUBMISSION_TYPES: readonly string[] = ['compile', 'evaluate'];
const LANE_VERBS: readonly string[] = ['evaluation:lane_assign', 'evaluation:lane_move'];

export interface LaneBoardItem {
  submissionId: number;
  lane: string;
  username: string;
  taskName: string;
  timestamp: string;
  waitingCount: number;
  assignedBy: number | null;
  reason: string | null;
}

export interface LaneBoardLane {
  lane: string;
  items: LaneBoardItem[];
}

export interface LaneBoard {
  lanes: LaneBoardLane[];
  waitingSource: 'rpc' | 'database';
}

interface LaneAssignment {
  submissionId: number;
  lane: string;
  reason: string | null;
  assignedBy: number | null;
}

type BoardSubmission = Prisma.submissionsGetPayload<{
  select: {
    id: true;
    timestamp: true;
    tasks: { select: { name: true } };
    participations: { select: { user_id: true; users: { select: { username: true } } } };
  };
}>;

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

function parseLanePayload(after: Prisma.JsonValue | null): { lane: string; reason: string | null } | null {
  if (typeof after !== 'object' || after === null || Array.isArray(after)) {
    return null;
  }
  const record = after as Record<string, Prisma.JsonValue | undefined>;
  const lane = record['lane'];
  if (typeof lane !== 'string' || lane.trim().length === 0) {
    return null;
  }
  const reason = record['reason'];
  return { lane: lane.trim(), reason: typeof reason === 'string' ? reason : null };
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

function extractQueuedIds(body: unknown): Set<number> | null {
  // Why strict shape: the proxy answers {data, error}; anything else means the
  // service is not really answering, so the database fallback must take over.
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { data, error } = body as { data?: unknown; error?: unknown };
  if (error !== null && error !== undefined) {
    return null;
  }
  if (!Array.isArray(data)) {
    return null;
  }
  const ids = new Set<number>();
  for (const entry of data as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const item = (entry as { item?: unknown }).item;
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { type, object_id } = item as { type?: unknown; object_id?: unknown };
    // Why only submission ops: user-test entries share the queue but belong to
    // no submission, so they must not inflate any submitter's waiting count.
    if (typeof object_id !== 'number' || !Number.isInteger(object_id)) {
      continue;
    }
    if (typeof type !== 'string' || !QUEUE_SUBMISSION_TYPES.includes(type)) {
      continue;
    }
    ids.add(object_id);
  }
  return ids;
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

function groupByLane(
  assignments: readonly LaneAssignment[],
  submissions: readonly BoardSubmission[],
  waitingByUser: ReadonlyMap<number, number>,
): LaneBoardLane[] {
  const byId = new Map(submissions.map((submission) => [submission.id, submission]));
  const groups = new Map<string, LaneBoardItem[]>();
  for (const assignment of assignments) {
    const submission = byId.get(assignment.submissionId);
    // Why skip, not placeholder: the audit row outlives a deleted submission,
    // and the board must not show rows that no longer exist.
    if (submission === undefined) {
      continue;
    }
    const userId = submission.participations.user_id;
    const item: LaneBoardItem = {
      submissionId: assignment.submissionId,
      lane: assignment.lane,
      username: submission.participations.users.username,
      taskName: submission.tasks.name,
      timestamp: submission.timestamp.toISOString(),
      waitingCount: waitingByUser.get(userId) ?? 0,
      assignedBy: assignment.assignedBy,
      reason: assignment.reason,
    };
    const laneItems = groups.get(assignment.lane);
    if (laneItems === undefined) {
      groups.set(assignment.lane, [item]);
    } else {
      laneItems.push(item);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([lane, items]) => ({
      lane,
      items: items.sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    }));
}
