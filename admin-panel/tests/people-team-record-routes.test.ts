import { describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';
import { notFound } from 'next/navigation';
import { buildTeamTabs, teamDescription, teamHeading } from '@/app/[locale]/(authenticated)/people/teams/[id]/layout';
import LegacyTeamsPage from '@/app/[locale]/(authenticated)/teams/page';
import LegacyTeamDetailPage from '@/app/[locale]/(authenticated)/teams/[id]/page';
import type { TeamSummary } from '@/lib/people-read-model-types';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); }),
}));

vi.mock('@/lib/server/authorization', () => ({
  requirePermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403) {
      super(`Unauthorized: ${status}`);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/people-read-models', () => ({
  getTeamSummary: vi.fn(),
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn() }));

const TEAM_RECORD_READER: readonly string[] = [
  'team:read',
  'participation:list',
  'user:read',
  'contest:read',
];

describe('Team record tab rail', () => {
  it('offers all three tabs in registry order to a complete reader', () => {
    const tabs = buildTeamTabs('en', 4, new Set(TEAM_RECORD_READER), en);
    expect(tabs.map((tab) => tab.id)).toEqual([
      'people.team-tabs.overview',
      'people.team-tabs.members',
      'people.team-tabs.contests',
    ]);
  });

  it('builds every tab href with the frozen builder and the record id', () => {
    const tabs = buildTeamTabs('th', 4, new Set(TEAM_RECORD_READER), en);
    expect(tabs.map((tab) => tab.href)).toEqual([
      '/th/people/teams/4/overview',
      '/th/people/teams/4/members',
      '/th/people/teams/4/contests',
    ]);
  });

  it.each([
    ['participation:list', ['people.team-tabs.overview']],
    ['user:read', ['people.team-tabs.overview', 'people.team-tabs.contests']],
    ['contest:read', ['people.team-tabs.overview', 'people.team-tabs.members']],
  ])('omits every tab that loses %s', (missingKey, expectedIds) => {
    const partialKeys = TEAM_RECORD_READER.filter((key) => key !== missingKey);
    const tabs = buildTeamTabs('en', 4, new Set(partialKeys), en);
    expect(tabs.map((tab) => tab.id)).toEqual(expectedIds);
  });

  it('conceals the whole rail from a caller without team:read', () => {
    expect(() => buildTeamTabs('en', 4, new Set(['participation:list', 'user:read', 'contest:read']), en))
      .toThrow('NEXT_NOT_FOUND');
  });

  it('exposes the Team page, record, and three tab descriptors as enabled registry routes', () => {
    const enabledIds = ROUTE_REGISTRY
      .filter((route) => route.id.startsWith('people.team') || route.id === 'people.teams')
      .filter((route) => route.enabled)
      .map((route) => route.id);
    expect(enabledIds).toEqual([
      'people.teams',
      'people.team-record',
      'people.team-tabs.overview',
      'people.team-tabs.members',
      'people.team-tabs.contests',
    ]);
  });
});

describe('Team record header identity', () => {
  const BASE: TeamSummary = {
    id: 4,
    code: 'THA-01',
    name: 'Thailand Team 1',
    organization: 'MWIT',
    leaderId: 9,
    leader: null,
    participationCount: 2,
  };

  it('heads the record with its name and describes it with the next identifier', () => {
    expect(teamHeading(BASE)).toBe('Thailand Team 1');
    expect(teamDescription(BASE)).toBe('THA-01');
  });

  it('falls back to the code when the row carries no name', () => {
    const unnamed = { ...BASE, name: null };

    expect(teamHeading(unnamed)).toBe('THA-01');
    expect(teamDescription(unnamed)).toBe('MWIT');
  });

  it('falls back to the id when the row carries neither a name nor a code', () => {
    const bare = { ...BASE, name: null, code: null };

    expect(teamHeading(bare)).toBe('#4');
    expect(teamDescription(bare)).toBe('MWIT');
  });

  it('never repeats the heading as its own description', () => {
    const cases: TeamSummary[] = [
      BASE,
      { ...BASE, name: null },
      { ...BASE, name: null, code: null },
      { ...BASE, name: null, code: null, organization: null },
    ];

    for (const summary of cases) {
      const heading = teamHeading(summary);
      expect(heading.trim(), JSON.stringify(summary)).not.toBe('');
      expect(teamDescription(summary), heading).not.toBe(heading);
    }
  });
});

describe('legacy /teams redirect', () => {
  it('renders the concealed view when the caller lacks team:list', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(403));
    await expect(
      LegacyTeamsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('renders the concealed view when the caller can read no People route', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['task:list']));
    await expect(
      LegacyTeamsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('falls back inside the People group for a denied legacy target', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['user:list']));
    await expect(
      LegacyTeamsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/en/people/users');
  });

  it('redirects a permitted caller to the locale-preserving canonical page', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['team:list']));
    await expect(
      LegacyTeamsPage({ params: Promise.resolve({ locale: 'th' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/th/people/teams');
  });
});

describe('legacy /teams/[id] bookmark', () => {
  it('conceals a malformed record id', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['team:read']));
    await expect(
      LegacyTeamDetailPage({ params: Promise.resolve({ locale: 'en', id: '4abc' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the concealed view when the caller lacks team:read', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(403));
    await expect(
      LegacyTeamDetailPage({ params: Promise.resolve({ locale: 'en', id: '4' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends an existing detail bookmark to the canonical record landing', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['team:read']));
    await expect(
      LegacyTeamDetailPage({ params: Promise.resolve({ locale: 'th', id: '4' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/th/people/teams/4');
  });
});
