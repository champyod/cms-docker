import { describe, expect, it, vi } from 'vitest';
import { getSubmissions, getUserHistory, getUserSummary } from '@/lib/people-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { requirePermission } from '@/lib/server/authorization';
import { prisma } from '@/lib/prisma';
import { submissionsListInclude } from '@/lib/prisma-selects';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    users: { findUnique: vi.fn() },
    submissions: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);

describe('People read models', () => {
  it('requires user:read before reading a user summary', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['user:read']));
    vi.mocked(prisma.users.findUnique).mockResolvedValue({
      id: 7,
      username: 'ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      status: 'active',
      organization: 'Analytical Engines',
      country: 'GB',
      _count: { participations: 2 },
      participations: [{ teams: { code: 'A-1', name: 'Alpha' } }],
    } as never);

    const result = await getUserSummary(7);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(result).toEqual({
      id: 7,
      username: 'ada',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'active',
      organization: 'Analytical Engines',
      country: 'GB',
      participationCount: 2,
      teamCodes: ['A-1'],
    });
  });

  it('omits unreadable account access and never adds a credential field to history', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['user:read', 'participation:list', 'submission:read']));
    vi.mocked(prisma.users.findUnique).mockResolvedValue({ id: 7, last_login_at: null, participations: [] } as never);

    const history = await getUserHistory(7);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(mockRequirePermission).toHaveBeenCalledWith('participation:list');
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(history?.accountAccess).toEqual({ lastLoginAt: null });
    expect(history).not.toHaveProperty('password');
    expect(history).not.toHaveProperty('authentication');
  });

  it('hides a People tab when one exact reader key is missing', () => {
    const cases = [
      ['people.user-tabs.teams', ['user:read', 'participation:list', 'team:read']],
      ['people.user-tabs.history', ['user:read', 'participation:list', 'submission:read']],
      ['people.team-tabs.members', ['team:read', 'participation:list', 'user:read']],
      ['people.team-tabs.contests', ['team:read', 'participation:list', 'contest:read']],
    ] as const;

    for (const [routeId, requiredKeys] of cases) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      if (!route) throw new Error(`Missing People route descriptor: ${routeId}`);
      expect(isRoutePermitted({ ...route, enabled: true }, new Set(requiredKeys))).toBe(true);
      for (const missingKey of requiredKeys) {
        const partialKeys = requiredKeys.filter((key) => key !== missingKey);
        expect(isRoutePermitted({ ...route, enabled: true }, new Set(partialKeys))).toBe(false);
      }
    }
  });
});

// Why: a non-null memory column is the shape that made a BigInt reachable, and the
// non-null values are exactly the ones the existing list fixture never sets.
const SUBMISSION_ROW = {
  id: 19,
  timestamp: new Date('2026-02-03T04:05:06.000Z'),
  language: 'cpp',
  comment: '',
  official: false,
  tasks: { id: 3, name: 'sum', title: 'Sum' },
  participations: { users: { username: 'ada' }, contests: { name: 'Thailand Cup' } },
  submission_results: [
    {
      score: 80,
      dataset_id: 1,
      compilation_outcome: 'ok',
      evaluation_outcome: 'ok',
      compilation_time: 12.5,
      compilation_memory: BigInt(3145728),
      compilation_text: ['ok'],
      compilation_stdout: 'out',
      compilation_stderr: 'err',
    },
  ],
  files: [{ filename: 'a.cpp', digest: 'abc' }],
};

// Why: the driver returns only the selected columns, so the fixture projects the
// full row through the real select instead of hand-writing the narrowed shape.
function prismaSubmissionsRow(): unknown {
  const select = submissionsListInclude.submission_results.select as Record<string, boolean>;
  const [stored] = SUBMISSION_ROW.submission_results;
  const projected = Object.fromEntries(
    Object.entries(stored).filter(([key]) => select[key] === true),
  );
  return { ...SUBMISSION_ROW, submission_results: [projected] };
}

function containsBigInt(value: unknown): boolean {
  if (typeof value === 'bigint') return true;
  if (Array.isArray(value)) return value.some(containsBigInt);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(containsBigInt);
  }
  return false;
}

async function loadListPayload(): Promise<Awaited<ReturnType<typeof getSubmissions>>> {
  mockRequirePermission.mockResolvedValue(new Set(['submission:list', 'submissionresult:read', 'file:read']));
  vi.mocked(prisma.submissions.findMany).mockResolvedValue([prismaSubmissionsRow()] as never);
  vi.mocked(prisma.submissions.count).mockResolvedValue(1 as never);
  return getSubmissions({ page: 1 });
}

describe('Submissions list payload', () => {
  it('carries only the result columns the list UI reads', async () => {
    const result = await loadListPayload();
    const [entry] = result.submissions[0].submission_results;

    expect(Object.keys(entry).sort()).toEqual(['compilation_outcome', 'evaluation_outcome', 'score']);
  });

  it('never puts a bigint on a server-to-client boundary', async () => {
    const result = await loadListPayload();
    const [entry] = result.submissions[0].submission_results;

    expect(containsBigInt(result)).toBe(false);
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  it('keeps the BigInt and log columns out of the select the list query runs', () => {
    expect(Object.keys(submissionsListInclude.submission_results.select)).toEqual([
      'score',
      'compilation_outcome',
      'evaluation_outcome',
    ]);
  });
});
