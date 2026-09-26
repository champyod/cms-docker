import { describe, expect, it, vi, beforeEach } from 'vitest';

interface AuditArgs {
  take?: number;
}

interface SubmissionArgs {
  take?: number;
  where: { id: { in: number[] } };
}

const calls = { audit: [] as AuditArgs[], submissions: [] as SubmissionArgs[] };
const stubs = {
  auditRows: [] as Array<{ entity_id: string; actor_id: number | null; after_values: unknown }>,
  submissions: [] as Array<{
    id: number;
    timestamp: Date;
    tasks: { name: string };
    participations: { user_id: number; users: { username: string } };
  }>,
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    audit_log: {
      findMany: async (args: AuditArgs) => {
        calls.audit.push(args);
        return args.take === undefined ? stubs.auditRows : stubs.auditRows.slice(0, args.take);
      },
    },
    submissions: {
      findMany: async (args: SubmissionArgs) => {
        calls.submissions.push(args);
        const ids = new Set(args.where.id.in);
        return stubs.submissions.filter((row) => ids.has(row.id));
      },
      count: async () => 0,
    },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.stubGlobal('fetch', async () => {
  throw new Error('queue RPC unavailable in tests');
});

const { getLaneBoard } = await import('@/app/actions/evaluationLanes');

function assignmentRow(submissionId: number, lane: string) {
  return { entity_id: String(submissionId), actor_id: 7, after_values: { lane, reason: null } };
}

function submissionRow(id: number) {
  return {
    id,
    timestamp: new Date('2026-01-01T00:00:00Z'),
    tasks: { name: 'task-a' },
    participations: { user_id: id, users: { username: `user${id}` } },
  };
}

beforeEach(() => {
  calls.audit = [];
  calls.submissions = [];
  stubs.auditRows = [];
  stubs.submissions = [];
});

describe('getLaneBoard bounding', () => {
  it('caps the audit scan so lane history cannot grow the response without limit', async () => {
    stubs.auditRows = Array.from({ length: 5000 }, (_, index) => assignmentRow(index + 1, 'judge-1'));

    await getLaneBoard();

    expect(calls.audit[0].take).toBeGreaterThan(0);
    expect(calls.audit[0].take).toBeLessThanOrEqual(2000);
  });

  it('pins the submission lookup to the capped assignment count', async () => {
    stubs.auditRows = [assignmentRow(1, 'judge-1')];
    stubs.submissions = [submissionRow(1)];

    await getLaneBoard();

    expect(calls.submissions[0].take).toBe(calls.submissions[0].where.id.in.length);
  });

  it('trims a single lane that exceeds the per-lane item cap', async () => {
    stubs.auditRows = Array.from({ length: 260 }, (_, index) => assignmentRow(index + 1, 'judge-1'));
    stubs.submissions = Array.from({ length: 260 }, (_, index) => submissionRow(index + 1));

    const board = await getLaneBoard();

    expect(board.lanes).toHaveLength(1);
    expect(board.lanes[0].items).toHaveLength(200);
  });

  it('keeps every lane when the total is under the per-lane cap', async () => {
    stubs.auditRows = [assignmentRow(1, 'judge-1'), assignmentRow(2, 'judge-2')];
    stubs.submissions = [submissionRow(1), submissionRow(2)];

    const board = await getLaneBoard();

    expect(board.lanes.map((lane) => lane.lane)).toEqual(['judge-1', 'judge-2']);
    expect(board.lanes.every((lane) => lane.items.length === 1)).toBe(true);
  });
});
