import type { Prisma } from '@prisma/client';
import type { LaneBoardItem, LaneBoardLane } from './evaluationLanes';

/** Why capped per lane: one busy lane must not crowd the others out of the
 * response, and assignments arrive newest-first so the head is the live work. */
const MAX_ITEMS_PER_LANE = 200;
const QUEUE_SUBMISSION_TYPES: readonly string[] = ['compile', 'evaluate'];

export interface LaneAssignment {
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

export function parseLanePayload(after: Prisma.JsonValue | null): { lane: string; reason: string | null } | null {
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

export function extractQueuedIds(body: unknown): Set<number> | null {
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

export function groupByLane(
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
    } else if (laneItems.length < MAX_ITEMS_PER_LANE) {
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
