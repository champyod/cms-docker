import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getSubmissions, getTeamContests, getTeamEditData, getTeamMembers, getTeamSummary, getTeams,
  getUserEditData, getUserHistory, getUserProfile, getUserSummary, getUserTeams,
} from '@/lib/people-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { requirePermission } from '@/lib/server/authorization';
import { prisma } from '@/lib/prisma';
import { submissionsListInclude, safeUserSelect } from '@/lib/prisma-selects';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    users: { findUnique: vi.fn() },
    participations: { findMany: vi.fn() },
    teams: { findUnique: vi.fn(), findMany: vi.fn() },
    submissions: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);
const mockUserFindUnique = vi.mocked(prisma.users.findUnique);
const mockParticipationFindMany = vi.mocked(prisma.participations.findMany);
const mockTeamFindUnique = vi.mocked(prisma.teams.findUnique);
const mockTeamFindMany = vi.mocked(prisma.teams.findMany);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);

function grant(keys: readonly string[]): void {
  mockRequirePermission.mockResolvedValue(new Set(keys));
}

const START = new Date('2026-02-03T04:05:06.000Z');
const STOP = new Date('2026-02-03T06:07:08.000Z');
const LAST_LOGIN = new Date('2026-01-02T03:04:05.000Z');

const TEAM_ROW = {
  id: 4,
  code: 'A-1',
  name: 'Alpha',
  organization: 'Analytical Engines',
  leader_id: 9,
  leader: { id: 9, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' },
  _count: { participations: 2 },
};

const PARTICIPATION_ROWS = [{
  id: 11,
  user_id: 9,
  contest_id: 3,
  team_id: 4,
  starting_time: START,
  contests: { id: 3, name: 'Thailand Cup', start: START, stop: STOP },
  teams: { id: 4, code: 'A-1', name: 'Alpha' },
  users: { id: 9, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' },
  submissions: [{
    id: 19,
    timestamp: START,
    language: 'cpp',
    official: true,
    task_id: 5,
    tasks: { id: 5, name: 'sum' },
    submission_results: [{ score: 80 }],
  }],
}];

const USER_ROW = {
  id: 9,
  username: 'ada',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.org',
  timezone: 'UTC',
  preferred_languages: ['cpp'],
  status: 'active',
  organization: 'Analytical Engines',
  country: 'GB',
  _count: { participations: 1 },
  participations: [{ teams: { code: 'A-1' } }],
};

function mockHistoryUser(lastLogin: Date | null): void {
  mockUserFindUnique.mockResolvedValue({ last_login_at: lastLogin, participations: PARTICIPATION_ROWS } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('People read models', () => {
  it('requires user:read before reading a user summary', async () => {
    grant(['user:read', 'participation:list', 'team:read']);
    mockUserFindUnique.mockResolvedValue({
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
    grant(['user:read', 'participation:list', 'submission:read']);
    // Why a real timestamp: toIso(undefined) and toIso(null) both answer null, so a
    // null seed would pass whether or not the field permission stripped the column.
    mockHistoryUser(LAST_LOGIN);
    mockQueryRaw.mockResolvedValue([] as never);

    const history = await getUserHistory(7);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(mockRequirePermission).toHaveBeenCalledWith('participation:list');
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(history?.accountAccess).toEqual({ lastLoginAt: null });
    expect(history).not.toHaveProperty('password');
    expect(history).not.toHaveProperty('authentication');
  });

  it('reports the last login for a reader holding audit:read', async () => {
    grant(['user:read', 'participation:list', 'submission:read', 'audit:read']);
    mockHistoryUser(LAST_LOGIN);
    mockQueryRaw.mockResolvedValue([] as never);

    const history = await getUserHistory(7);

    expect(history?.accountAccess).toEqual({ lastLoginAt: '2026-01-02T03:04:05.000Z' });
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

const TEAM_LIST_READER = ['team:list'];
const TEAM_READERS = ['team:list', 'team:read', 'user:read'];
const MEMBERS_READER = ['team:read', 'participation:list', 'user:read'];
const MEMBERS_WITH_CONTESTS = [...MEMBERS_READER, 'contest:read'];
const MEMBERSHIP_READER = ['user:read', 'participation:list', 'team:read'];
const MEMBERSHIP_WITH_COLUMNS = [...MEMBERSHIP_READER, 'participation:read', 'contest:read'];
const HISTORY_READER = ['user:read', 'participation:list', 'submission:read'];
const HISTORY_WITH_COLUMNS = [...HISTORY_READER, 'audit:read', 'participation:read', 'contest:read', 'team:read', 'task:read', 'submissionresult:read'];

// Why one table: every People reader resolves its governed columns the same way, so
// one full-reader/partial-reader pair per reader proves the rule for all of them
// instead of repeating near-identical bodies per field.
interface ReaderCase {
  readonly name: string;
  readonly fullReader: readonly string[];
  readonly partialReader: readonly string[];
  readonly serve: (permissions: readonly string[]) => Promise<unknown>;
  readonly governed: (result: unknown) => Record<string, unknown>;
  readonly fullPayload: Record<string, unknown>;
  readonly partialPayload: Record<string, unknown>;
}

const READER_CASES: readonly ReaderCase[] = [
  {
    name: 'getTeams',
    fullReader: TEAM_READERS,
    partialReader: TEAM_LIST_READER,
    serve: async (permissions) => {
      grant(permissions);
      mockTeamFindMany.mockResolvedValue([TEAM_ROW] as never);
      const result = await getTeams();
      return result.teams[0];
    },
    governed: (team) => {
      const row = team as { code: string | null; name: string | null; organization: string | null; leaderId: number | null; leader: { username: string } | null };
      return { code: row.code, name: row.name, organization: row.organization, leaderId: row.leaderId, leader: row.leader?.username ?? null };
    },
    fullPayload: { code: 'A-1', name: 'Alpha', organization: 'Analytical Engines', leaderId: 9, leader: 'ada' },
    partialPayload: { code: null, name: null, organization: null, leaderId: null, leader: null },
  },
  {
    name: 'getTeamSummary',
    fullReader: TEAM_READERS,
    partialReader: ['team:read'],
    serve: async (permissions) => {
      grant(permissions);
      mockTeamFindUnique.mockResolvedValue(TEAM_ROW as never);
      return getTeamSummary(4);
    },
    governed: (team) => {
      const row = team as { code: string | null; name: string | null; leaderId: number | null; leader: { username: string } | null };
      return { code: row.code, name: row.name, leaderId: row.leaderId, leader: row.leader?.username ?? null };
    },
    fullPayload: { code: 'A-1', name: 'Alpha', leaderId: 9, leader: 'ada' },
    partialPayload: { code: 'A-1', name: 'Alpha', leaderId: 9, leader: null },
  },
  {
    name: 'getUserTeams',
    fullReader: MEMBERSHIP_WITH_COLUMNS,
    partialReader: MEMBERSHIP_READER,
    serve: async (permissions) => {
      grant(permissions);
      mockParticipationFindMany.mockResolvedValue(PARTICIPATION_ROWS as never);
      const rows = await getUserTeams(9);
      return rows[0];
    },
    governed: (membership) => {
      const row = membership as { contestId: number | null; contestName: string | null; teamId: number | null; teamCode: string | null };
      return { contestId: row.contestId, contestName: row.contestName, teamId: row.teamId, teamCode: row.teamCode };
    },
    fullPayload: { contestId: 3, contestName: 'Thailand Cup', teamId: 4, teamCode: 'A-1' },
    partialPayload: { contestId: null, contestName: null, teamId: null, teamCode: 'A-1' },
  },
  {
    name: 'getTeamMembers',
    fullReader: MEMBERS_WITH_CONTESTS,
    partialReader: MEMBERS_READER,
    serve: async (permissions) => {
      grant(permissions);
      mockTeamFindUnique.mockResolvedValue({ id: 4, participations: PARTICIPATION_ROWS } as never);
      const rows = await getTeamMembers(4);
      return rows[0];
    },
    governed: (member) => {
      const row = member as { username: string | null; contests: { id: number | null; name: string | null }[] };
      return { username: row.username, contests: row.contests };
    },
    fullPayload: { username: 'ada', contests: [{ id: 3, name: 'Thailand Cup' }] },
    partialPayload: { username: 'ada', contests: [{ id: null, name: null }] },
  },
  {
    name: 'getUserHistory participation row',
    fullReader: HISTORY_WITH_COLUMNS,
    partialReader: HISTORY_READER,
    serve: async (permissions) => {
      grant(permissions);
      mockHistoryUser(LAST_LOGIN);
      mockQueryRaw.mockResolvedValue([{ id: 11, delay_time_seconds: 60, extra_time_seconds: 120 }] as never);
      const history = await getUserHistory(9);
      return history?.participations[0];
    },
    governed: (participation) => {
      const row = participation as { contestId: number | null; contestName: string | null; teamId: number | null; teamCode: string | null; startingTime: string | null };
      return { contestId: row.contestId, contestName: row.contestName, teamId: row.teamId, teamCode: row.teamCode, startingTime: row.startingTime };
    },
    fullPayload: { contestId: 3, contestName: 'Thailand Cup', teamId: 4, teamCode: 'A-1', startingTime: '2026-02-03T04:05:06.000Z' },
    partialPayload: { contestId: null, contestName: null, teamId: null, teamCode: null, startingTime: null },
  },
  {
    name: 'getUserHistory submission row',
    fullReader: HISTORY_WITH_COLUMNS,
    partialReader: HISTORY_READER,
    serve: async (permissions) => {
      grant(permissions);
      mockHistoryUser(LAST_LOGIN);
      mockQueryRaw.mockResolvedValue([] as never);
      const history = await getUserHistory(9);
      return history?.submissions[0];
    },
    governed: (submission) => {
      const row = submission as { taskName: string | null; score: number | null; language: string | null };
      return { taskName: row.taskName, score: row.score, language: row.language };
    },
    fullPayload: { taskName: 'sum', score: 80, language: 'cpp' },
    partialPayload: { taskName: null, score: null, language: 'cpp' },
  },
];

describe('People reader field filtering', () => {
  it.each(READER_CASES)('$name serves a full reader', async (readerCase) => {
    const served = await readerCase.serve(readerCase.fullReader);

    expect(readerCase.governed(served)).toEqual(readerCase.fullPayload);
  });

  it.each(READER_CASES)('$name nulls every column a partial reader may not read', async (readerCase) => {
    const served = await readerCase.serve(readerCase.partialReader);

    expect(readerCase.governed(served)).toEqual(readerCase.partialPayload);
  });
});

describe('People reader relations and gates', () => {
  it('withholds the team codes a user:read-only caller may not read', async () => {
    grant(['user:read']);
    mockUserFindUnique.mockResolvedValue(USER_ROW as never);

    const result = await getUserSummary(9);

    expect(result?.teamCodes).toEqual([]);
  });

  it('omits contests and teams the history reader may not read', async () => {
    grant(HISTORY_READER);
    mockHistoryUser(LAST_LOGIN);
    mockQueryRaw.mockResolvedValue([] as never);

    const history = await getUserHistory(9);

    expect(history?.contests).toEqual([]);
    expect(history?.teams).toEqual([]);
  });

  it('keeps the contests and teams a full history reader may read', async () => {
    grant(HISTORY_WITH_COLUMNS);
    mockHistoryUser(LAST_LOGIN);
    mockQueryRaw.mockResolvedValue([] as never);

    const history = await getUserHistory(9);

    expect(history?.contests).toEqual([{ id: 3, name: 'Thailand Cup', start: '2026-02-03T04:05:06.000Z', stop: '2026-02-03T06:07:08.000Z' }]);
    expect(history?.teams).toEqual([{ id: 4, code: 'A-1', name: 'Alpha' }]);
  });

  it('serves the full profile to a user:read caller', async () => {
    grant(['user:read']);
    mockUserFindUnique.mockResolvedValue(USER_ROW as never);

    const profile = await getUserProfile(9);

    expect(profile).toEqual({
      id: 9,
      username: 'ada',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.org',
      timezone: 'UTC',
      preferredLanguages: ['cpp'],
      status: 'active',
      organization: 'Analytical Engines',
      country: 'GB',
    });
  });

  it('serves the contests a contest:read caller reaches', async () => {
    grant(['team:read', 'participation:list', 'contest:read']);
    mockTeamFindUnique.mockResolvedValue({ id: 4, participations: [{ contests: { id: 3, name: 'Thailand Cup', description: 'national', start: START, stop: STOP } }] } as never);

    const contests = await getTeamContests(4);

    expect(contests).toEqual([{ id: 3, name: 'Thailand Cup', description: 'national', start: '2026-02-03T04:05:06.000Z', stop: '2026-02-03T06:07:08.000Z' }]);
  });

  it('rejects a team contests reader that is missing contest:read', async () => {
    mockRequirePermission.mockImplementation(async (permission: string) => {
      if (permission === 'contest:read') throw Object.assign(new Error('Forbidden'), { status: 403, permission });
      return new Set(['team:read', 'participation:list']);
    });

    await expect(getTeamContests(4)).rejects.toMatchObject({ status: 403, permission: 'contest:read' });
    expect(mockTeamFindUnique).not.toHaveBeenCalled();
  });

  it('serves the contests of a member to a caller holding contest:read', async () => {
    grant(MEMBERS_WITH_CONTESTS);
    mockTeamFindUnique.mockResolvedValue({ id: 4, participations: PARTICIPATION_ROWS } as never);

    const members = await getTeamMembers(4);

    expect(members).toEqual([{
      userId: 9,
      username: 'ada',
      firstName: 'Ada',
      lastName: 'Lovelace',
      contests: [{ id: 3, name: 'Thailand Cup' }],
    }]);
  });
});

// Why official and language are pinned beside score: all three sit on one submission
// row, but only score rides the submission_results relation, so moving either
// submissions column onto submissionresult:read would leak nothing and still pass
// a score-only assertion.
const SCORE_READER = [...HISTORY_READER, 'submissionresult:read'];

async function serveHistoryFor(keys: readonly string[]): Promise<Awaited<ReturnType<typeof getUserHistory>>> {
  grant(keys);
  mockHistoryUser(LAST_LOGIN);
  mockQueryRaw.mockResolvedValue([] as never);
  return getUserHistory(9);
}

describe('User history score gating', () => {
  it('withholds the score from a submission:read-only caller and keeps the submission fields', async () => {
    const history = await serveHistoryFor(HISTORY_READER);

    expect(history?.submissions[0]).toMatchObject({ id: 19, language: 'cpp', official: true, score: null });
  });

  it('carries the score for a caller that also holds submissionresult:read', async () => {
    const history = await serveHistoryFor(SCORE_READER);

    expect(history?.submissions[0]).toMatchObject({ id: 19, language: 'cpp', official: true, score: 80 });
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
  grant(['submission:list', 'submissionresult:read', 'file:read']);
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

describe('Record edit payloads', () => {
  it('requires user:read and selects only the fields the user edit form reads', async () => {
    grant(['user:read']);
    // Why the narrow row: Prisma's select is what bounds the payload, so the mock
    // has to answer with that shape for the returned object to prove the bound.
    const { id, username, first_name, last_name, email, timezone, preferred_languages } = USER_ROW;
    mockUserFindUnique.mockResolvedValue({ id, username, first_name, last_name, email, timezone, preferred_languages } as never);

    const result = await getUserEditData(9);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(mockUserFindUnique.mock.calls[0][0]).toMatchObject({ where: { id: 9 }, select: safeUserSelect });
    expect(result).toEqual({
      id: 9,
      username: 'ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.org',
      timezone: 'UTC',
      preferred_languages: ['cpp'],
    });
  });

  it('never selects a credential column for the user edit payload', () => {
    expect(Object.keys(safeUserSelect)).not.toContain('password');
  });

  it('requires team:read and returns the code and name the team edit form reads', async () => {
    grant(['team:read']);
    mockTeamFindUnique.mockResolvedValue({ id: 4, code: 'A-1', name: 'Alpha' } as never);

    const result = await getTeamEditData(4);

    expect(mockRequirePermission).toHaveBeenCalledWith('team:read');
    expect(Object.keys(mockTeamFindUnique.mock.calls[0][0].select ?? {}).sort()).toEqual(['code', 'id', 'name']);
    expect(result).toEqual({ id: 4, code: 'A-1', name: 'Alpha' });
  });

  it('nulls a team field the caller cannot read instead of returning the stored value', async () => {
    // Why a key the reader did not require: the mock resolves requirePermission to
    // whatever is granted, so granting only team:list is the one way to observe a
    // field the access table strips.
    grant(['team:list']);
    mockTeamFindUnique.mockResolvedValue({ id: 4, code: 'A-1', name: 'Alpha' } as never);

    expect(await getTeamEditData(4)).toEqual({ id: 4, code: null, name: null });
  });

  it('reports a missing record as null rather than an empty payload', async () => {
    grant(['team:read']);
    mockTeamFindUnique.mockResolvedValue(null as never);

    expect(await getTeamEditData(404)).toBeNull();
  });
});
