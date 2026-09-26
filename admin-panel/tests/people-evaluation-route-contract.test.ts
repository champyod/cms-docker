import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/dictionaries/en.json';
import { notFound } from 'next/navigation';
import PeopleTeamsPage from '@/app/[locale]/(authenticated)/people/teams/page';
import EvaluationSubmissionsPage from '@/app/[locale]/(authenticated)/evaluation/submissions/page';
import UserHistoryPage from '@/app/[locale]/(authenticated)/people/users/[id]/history/page';
import TeamMembersPage from '@/app/[locale]/(authenticated)/people/teams/[id]/members/page';
import SubmissionResultsPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/results/page';
import { getTeams, getSubmissions, getTeamMembers, getUserHistory } from '@/lib/people-read-models';
import { getSubmissionResults } from '@/lib/evaluation-read-models';
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
  getTeams: vi.fn(),
  getSubmissions: vi.fn(),
  getTeamMembers: vi.fn(),
  getUserHistory: vi.fn(),
}));

vi.mock('@/lib/evaluation-read-models', () => ({
  getSubmissionResults: vi.fn(),
  getSubmissionSummary: vi.fn(),
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => en) }));

const RECORD_DIR = 'src/app/[locale]/(authenticated)';
const CANONICAL_BOUNDARY_PATHS = [
  `${RECORD_DIR}/people/loading.tsx`,
  `${RECORD_DIR}/people/error.tsx`,
  `${RECORD_DIR}/people/not-found.tsx`,
  `${RECORD_DIR}/people/users/page.tsx`,
  `${RECORD_DIR}/people/teams/page.tsx`,
  `${RECORD_DIR}/people/users/[id]/not-found.tsx`,
  `${RECORD_DIR}/people/users/[id]/profile/loading.tsx`,
  `${RECORD_DIR}/people/users/[id]/teams/loading.tsx`,
  `${RECORD_DIR}/people/users/[id]/history/loading.tsx`,
  `${RECORD_DIR}/people/teams/[id]/not-found.tsx`,
  `${RECORD_DIR}/people/teams/[id]/overview/loading.tsx`,
  `${RECORD_DIR}/people/teams/[id]/members/loading.tsx`,
  `${RECORD_DIR}/people/teams/[id]/contests/loading.tsx`,
  `${RECORD_DIR}/evaluation/loading.tsx`,
  `${RECORD_DIR}/evaluation/error.tsx`,
  `${RECORD_DIR}/evaluation/not-found.tsx`,
  `${RECORD_DIR}/evaluation/submissions/page.tsx`,
  `${RECORD_DIR}/evaluation/lanes/page.tsx`,
  `${RECORD_DIR}/evaluation/submissions/[id]/not-found.tsx`,
  `${RECORD_DIR}/evaluation/submissions/[id]/summary/loading.tsx`,
  `${RECORD_DIR}/evaluation/submissions/[id]/results/loading.tsx`,
  `${RECORD_DIR}/evaluation/submissions/[id]/logs/loading.tsx`,
  `${RECORD_DIR}/evaluation/submissions/[id]/evaluation/loading.tsx`,
] as const;

const RECORD_PARAMS = Promise.resolve({ locale: 'en', id: '17' });
const LIST_PARAMS = Promise.resolve({ locale: 'en' });
const EMPTY_SEARCH = Promise.resolve({ page: '1' });

// Why: globals are disabled in vitest.config.ts, so the "did not conceal" and
// "did not read" assertions below would otherwise see calls from earlier cases.
beforeEach(() => {
  vi.clearAllMocks();
});

function denyEverything(): void {
  vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(403));
}

function grant(keys: readonly string[]): void {
  vi.mocked(requirePermission).mockImplementation(async (permission: string) => {
    if (!keys.includes(permission)) throw new AuthorizationError(403);
    return new Set(keys);
  });
}

describe('canonical People and Evaluation list pages', () => {
  it('fails until every canonical list page and boundary file exists', () => {
    for (const path of CANONICAL_BOUNDARY_PATHS) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });

  it('conceals the team list before the reader runs for a missing team:list', async () => {
    denyEverything();

    await expect(PeopleTeamsPage({ params: LIST_PARAMS })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(getTeams).not.toHaveBeenCalled();
  });

  it('conceals the submission list before the reader runs for a missing submission:list', async () => {
    denyEverything();

    await expect(
      EvaluationSubmissionsPage({ params: LIST_PARAMS, searchParams: EMPTY_SEARCH }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getSubmissions).not.toHaveBeenCalled();
  });
});

describe('nested record tab access', () => {
  it('conceals a user history tab before the reader runs for a missing submission:read', async () => {
    grant(['user:read', 'participation:list']);

    await expect(UserHistoryPage({ params: RECORD_PARAMS })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getUserHistory).not.toHaveBeenCalled();
  });

  it('conceals a team members tab before the reader runs for a missing user:read', async () => {
    grant(['team:read', 'participation:list']);

    await expect(TeamMembersPage({ params: RECORD_PARAMS })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getTeamMembers).not.toHaveBeenCalled();
  });

  it('conceals a submission results tab before the reader runs for a missing file:read', async () => {
    grant(['submission:read', 'submissionresult:read']);

    await expect(SubmissionResultsPage({ params: RECORD_PARAMS })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(getSubmissionResults).not.toHaveBeenCalled();
  });

  it('hides a permitted tab whose row is missing behind the same concealed view', async () => {
    grant(['user:read', 'participation:list', 'submission:read']);
    vi.mocked(getUserHistory).mockResolvedValue(null);

    await expect(UserHistoryPage({ params: RECORD_PARAMS })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
  });

  it('conceals a malformed record id before any permission is resolved', async () => {
    denyEverything();

    await expect(
      TeamMembersPage({ params: Promise.resolve({ locale: 'en', id: '12abc' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(requirePermission).not.toHaveBeenCalled();
    expect(getTeamMembers).not.toHaveBeenCalled();
  });
});

describe('unconcealed authorization failures', () => {
  it('lets a 401 reach the session layout instead of the not-found boundary', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(401));

    await expect(PeopleTeamsPage({ params: LIST_PARAMS })).rejects.toThrow('Unauthorized: 401');

    expect(notFound).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure reach the error boundary instead of the not-found boundary', async () => {
    const failure = new Error('database unavailable');
    grant(['team:read', 'participation:list', 'user:read']);
    vi.mocked(getTeamMembers).mockRejectedValue(failure);

    await expect(TeamMembersPage({ params: RECORD_PARAMS })).rejects.toThrow(failure);

    expect(notFound).not.toHaveBeenCalled();
  });
});
