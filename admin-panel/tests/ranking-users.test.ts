import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participations: { findMany: vi.fn(), findFirst: vi.fn() },
    tasks: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => undefined) }));

import { getRankingUserDetail, getRankingUsers } from '@/app/actions/ranking';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const mockParticipationsFindMany = vi.mocked(prisma.participations.findMany);
const mockParticipationsFindFirst = vi.mocked(prisma.participations.findFirst);
const mockTasksFindMany = vi.mocked(prisma.tasks.findMany);
const mockEnsurePermission = vi.mocked(ensurePermission);

const LIST_PAGE = 'src/app/[locale]/(authenticated)/ranking/users/page.tsx';
const DETAIL_PAGE = 'src/app/[locale]/(authenticated)/ranking/users/[key]/page.tsx';
const OVERRIDE_FORM = 'src/components/ranking/RankingOverrideForm.tsx';

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

interface ParticipationSeed {
  readonly id: number;
  readonly contestId: number;
  readonly userId: number;
  readonly username: string;
  readonly score: number;
  readonly hidden?: boolean;
  readonly teamName?: string | null;
}

function participation(seed: ParticipationSeed): unknown {
  return {
    id: seed.id,
    contest_id: seed.contestId,
    user_id: seed.userId,
    hidden: seed.hidden ?? false,
    users: {
      id: seed.userId,
      username: seed.username,
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
    teams: seed.teamName === undefined || seed.teamName === null ? null : { id: 1, name: seed.teamName },
    submissions: [
      {
        official: true,
        tasks: { id: 5, name: 'sum', title: 'Sum', num: 1 },
        submission_results: [{ score: seed.score, dataset_id: 1 }],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ranking users read model', () => {
  it('lists every participation, including a hidden one, through the ranking read model', async () => {
    mockParticipationsFindMany.mockResolvedValue([
      participation({ id: 11, contestId: 3, userId: 9, username: 'ada', score: 80, teamName: 'Alpha' }),
      participation({ id: 12, contestId: 3, userId: 10, username: 'bob', score: 100, hidden: true }),
    ] as never);

    const users = await getRankingUsers();

    expect(mockEnsurePermission).toHaveBeenCalledWith('ranking:list');
    expect(users.find((entry) => entry.username === 'ada')).toMatchObject({
      participationId: 11,
      contestId: 3,
      userId: 9,
      username: 'ada',
      displayName: 'Ada Lovelace',
      teamName: 'Alpha',
      hidden: false,
      totalScore: 80,
      rank: 2,
    });
    expect(users.find((entry) => entry.username === 'bob')).toMatchObject({
      hidden: true,
      teamName: null,
      totalScore: 100,
      rank: 1,
    });
  });

  it('ranks each contest on its own board', async () => {
    mockParticipationsFindMany.mockResolvedValue([
      participation({ id: 1, contestId: 3, userId: 9, username: 'ada', score: 80 }),
      participation({ id: 2, contestId: 4, userId: 11, username: 'cara', score: 50 }),
    ] as never);

    const users = await getRankingUsers();

    expect(users.find((entry) => entry.username === 'ada')?.rank).toBe(1);
    expect(users.find((entry) => entry.username === 'cara')?.rank).toBe(1);
  });

  it('serves one user beside the contest task columns', async () => {
    mockParticipationsFindFirst.mockResolvedValue({ contest_id: 3, user_id: 9 } as never);
    mockParticipationsFindMany.mockResolvedValue([
      participation({ id: 11, contestId: 3, userId: 9, username: 'ada', score: 80, teamName: 'Alpha' }),
    ] as never);
    mockTasksFindMany.mockResolvedValue([
      { id: 5, name: 'sum', title: 'Sum', score_precision: 0 },
    ] as never);

    const detail = await getRankingUserDetail('ada');

    expect(detail?.entry).toMatchObject({ userId: 9, username: 'ada', teamName: 'Alpha', rank: 1 });
    expect(detail?.tasks).toEqual([{ id: 5, name: 'sum', title: 'Sum', scorePrecision: 0 }]);
  });

  it('reports an unknown user as null rather than throwing', async () => {
    mockParticipationsFindFirst.mockResolvedValue(null as never);

    await expect(getRankingUserDetail('missing')).resolves.toBeNull();
  });
});

describe('ranking users route', () => {
  const ROUTE_ID = 'ranking.users' as const;

  it('registers the page beside its siblings with the ranking read gate', () => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === ROUTE_ID);

    expect(route).toMatchObject({ path: '/ranking/users', kind: 'page', enabled: true, legacyPaths: [] });
    expect(route?.permission).toEqual({ all: ['ranking:list', 'ranking:read'] });
    expect(route?.surfaces).not.toContain('shortcuts');
  });

  it('conceals the route unless the reader holds both ranking keys', () => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === ROUTE_ID);
    if (!route) throw new Error('Missing ranking.users descriptor');
    const enabled = { ...route, enabled: true };

    expect(isRoutePermitted(enabled, new Set(['ranking:list']))).toBe(false);
    expect(isRoutePermitted(enabled, new Set(['ranking:read']))).toBe(false);
    expect(isRoutePermitted(enabled, new Set(['ranking:list', 'ranking:read']))).toBe(true);
  });

  it('lists the route in the ranking group straight after the board', () => {
    const group = NAVIGATION_GROUPS.find((candidate) => candidate.id === 'ranking');

    expect(group?.routeIds).toEqual([
      'ranking.board',
      'ranking.users',
      'ranking.settings',
      'ranking.appearance',
      'ranking.credits',
    ]);
  });

  it('publishes the label and description in both locales', () => {
    for (const dictionary of [en, th]) {
      expect(dictionary.navigation.ranking.users.label.trim()).not.toBe('');
      expect(dictionary.navigation.ranking.users.description.trim()).not.toBe('');
    }
  });
});

describe('ranking users pages', () => {
  it('authorizes both views through the registered route on core primitives', () => {
    for (const file of [LIST_PAGE, DETAIL_PAGE]) {
      const source = readProjectFile(file);
      expect(source).toContain("authorizeRoutePage('ranking.users')");
      expect(source).not.toContain("from '@/components/ui/");
    }
  });

  it('offers the existing override actions and server actions from both views', () => {
    for (const file of [LIST_PAGE, DETAIL_PAGE]) {
      expect(readProjectFile(file)).toContain('RankingOverrideForm');
    }
    expect(readProjectFile(DETAIL_PAGE)).toContain('endRankingOverride');
    expect(readProjectFile(OVERRIDE_FORM)).toContain('saveRankingOverride');
  });
});
