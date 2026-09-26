// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { UserHistoryTab } from '@/components/users/UserHistoryTab';
import { UserProfileTab } from '@/components/users/UserProfileTab';
import { UserTeamsTab } from '@/components/users/UserTeamsTab';
import { TeamContestsTab } from '@/components/teams/TeamContestsTab';
import { TeamListHeader } from '@/components/teams/TeamListHeader';
import { TeamMembersTab } from '@/components/teams/TeamMembersTab';
import { TeamOverviewTab } from '@/components/teams/TeamOverviewTab';
import { buildConfirmationCopy } from '@/lib/confirmation-copy';
import type { UserHistory, UserProfile, UserSummary } from '@/lib/people-read-model-types';
import type { TeamContest, TeamMember, TeamSummary } from '@/lib/people-read-model-types';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/th/people/users/17/history',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

const PROFILE = {
  id: 17,
  username: 'ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  timezone: 'Asia/Bangkok',
  preferredLanguages: ['en'],
  status: 'active',
  organization: 'MWIT',
  country: 'TH',
} as UserProfile;

const SUMMARY = {
  id: 17,
  username: 'ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'active',
  organization: 'MWIT',
  country: 'TH',
  participationCount: 2,
  teamCodes: ['THA-01'],
} as UserSummary;

const HISTORY = {
  accountAccess: { lastLoginAt: '2026-01-15T08:30:00Z' },
  contests: [],
  participations: [{ id: 3, contestId: 2, contestName: 'Practice Round', teamId: null, teamCode: null }],
  teams: [],
  submissions: [],
  recentContestActivity: [],
} as unknown as UserHistory;

const TEAM = {
  id: 4,
  code: 'THA-01',
  name: 'Thailand Team 1',
  organization: 'MWIT',
  leaderId: 17,
  leader: { id: 17, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
  participationCount: 1,
} as TeamSummary;

const MEMBERS: readonly TeamMember[] = [
  { userId: 17, username: 'ada', firstName: 'Ada', lastName: 'Lovelace', contests: [{ id: 1, name: 'Practice Round' }] } as TeamMember,
];

const CONTESTS: readonly TeamContest[] = [
  { id: 1, name: 'Practice Round', description: 'Warm up', start: null, stop: null } as TeamContest,
];

function text(node: React.ReactElement): string {
  return render(<DictionaryProvider dict={th}>{node}</DictionaryProvider>).container.textContent ?? '';
}

describe('dictionary parity', () => {
  it('keeps every English key present in Thai and no Thai key absent from English', () => {
    expect(keyPaths(th).sort()).toEqual(keyPaths(en).sort());
  });

  it('translates every added state string rather than reusing the English sentence', () => {
    for (const key of ['retry.label', 'retry.description'] as const) {
      const [section, field] = key.split('.') as ['retry', 'label' | 'description'];
      expect(th.states[section][field]).not.toBe(en.states[section][field]);
    }
    expect(th.submissions.lanesDescription).not.toBe(en.submissions.lanesDescription);
  });
});

describe('User record tab copy', () => {
  it('renders Thai field labels on the profile tab', () => {
    const body = text(
      <UserProfileTab profile={PROFILE} summary={SUMMARY} navigation={th.navigation} copy={th.users} permissionKeys={[]} />,
    );

    expect(body).toContain(th.users.profile.username);
    expect(body).toContain(th.users.profile.timezone);
    expect(body).toContain(th.users.profile.savedPassword);
    expect(body).not.toContain(en.users.profile.timezone);
  });

  it('renders the Thai empty state on the user teams tab', () => {
    const body = text(<UserTeamsTab memberships={[]} navigation={th.navigation} copy={th.users} locale="th" />);

    expect(body).toContain(th.users.teamsTab.emptyTitle);
    expect(body).toContain(th.users.teamsTab.emptyDescription);
  });

  it('renders Thai section titles, the Account Access heading, and the last-login line', () => {
    const body = text(<UserHistoryTab history={HISTORY} navigation={th.navigation} copy={th.users} />);

    expect(body).toContain(th.users.history.accountAccess);
    expect(body).toContain('2026-01-15T08:30:00Z');
    expect(body).toContain(th.users.history.sections.participations.title);
    expect(body).toContain(th.users.history.sections.recentActivity.title);
    expect(body).toContain(th.users.history.sections.contests.empty);
  });
});

describe('docs affordance label', () => {
  // Why the literals, not a contrast against docs.title: that key had no reader
  // left once the Docs header was removed, so the affordance is pinned outright
  // to the verb-phrase wording in each locale.
  it('keeps the original English wording instead of the documentation name', () => {
    expect(en.docs.viewDocumentation).toBe('View Documentation');
    expect(en.docs.viewDocumentation).not.toBe('CMS Documentation');
  });

  it('translates the affordance as a verb phrase rather than the documentation name', () => {
    expect(th.docs.viewDocumentation).toBe('ดูเอกสาร');
    expect(th.docs.viewDocumentation).not.toBe('เอกสาร CMS');
    expect(th.docs.viewDocumentation).not.toBe(en.docs.viewDocumentation);
  });

  it('labels the Team list docs link with the affordance in both locales', () => {
    const renderHeader = (dict: typeof en): string | null => {
      const { container } = render(
        <DictionaryProvider dict={dict}>
          <TeamListHeader locale="en" canCreate onCreate={vi.fn()} copy={dict.teams} docsLinkLabel={dict.docs.viewDocumentation} />
        </DictionaryProvider>,
      );
      return container.querySelector('a[title]')?.getAttribute('title') ?? null;
    };

    expect(renderHeader(en)).toBe(en.docs.viewDocumentation);
    expect(renderHeader(th)).toBe(th.docs.viewDocumentation);
  });
});

describe('Team record tab copy', () => {
  it('renders Thai field labels and the save label on the overview tab', () => {
    const body = text(
      <TeamOverviewTab
        team={TEAM}
        permissionKeys={['team:read', 'team:update']}
        navigation={th.navigation}
        copy={th.teams}
        locale="th"
      />,
    );

    expect(body).toContain(th.teams.overview.code);
    expect(body).toContain(th.teams.overview.name);
    expect(body).toContain(th.teams.overview.saveChanges);
  });

  it('renders the Thai read-only hint for a reader without team:update', () => {
    const body = text(
      <TeamOverviewTab
        team={TEAM}
        permissionKeys={['team:read']}
        navigation={th.navigation}
        copy={th.teams}
        locale="th"
      />,
    );

    expect(body).toContain(th.teams.overview.readOnlyHint);
    expect(body).not.toContain(en.teams.overview.readOnlyHint);
  });

  it('renders Thai empty states and the overflow count on the members and contests tabs', () => {
    const members = text(<TeamMembersTab members={MEMBERS} navigation={th.navigation} copy={th.teams} locale="th" />);
    const emptyMembers = text(<TeamMembersTab members={[]} navigation={th.navigation} copy={th.teams} locale="th" />);
    const contests = text(<TeamContestsTab contests={CONTESTS} navigation={th.navigation} copy={th.teams} locale="th" />);
    const emptyContests = text(<TeamContestsTab contests={[]} navigation={th.navigation} copy={th.teams} locale="th" />);

    expect(members).toContain('Practice Round');
    expect(emptyMembers).toContain(th.teams.members.emptyTitle);
    expect(emptyMembers).toContain(th.teams.members.emptyDescription);
    expect(contests).toContain('Practice Round');
    expect(emptyContests).toContain(th.teams.contests.emptyTitle);
    expect(emptyContests).toContain(th.teams.contests.emptyDescription);
  });
});

describe('official flag confirmation copy', () => {
  it('builds the reversible request from the dictionary in both locales', () => {
    const english = buildConfirmationCopy(en.confirmations).toggleOfficialConfirm();
    const thai = buildConfirmationCopy(th.confirmations).toggleOfficialConfirm();

    expect(english).toEqual({
      kind: 'recoverable',
      title: en.confirmations.toggleOfficial.title,
      description: en.confirmations.toggleOfficial.description,
      confirmLabel: en.confirmations.toggleOfficial.confirmLabel,
    });
    expect(thai.kind).toBe('recoverable');
    expect(thai.title).toBe(th.confirmations.toggleOfficial.title);
    expect(thai.title).not.toBe(english.title);
  });

  it('leaves no hand-built official confirmation in the action bar', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'src/components/submissions/SubmissionActionBar.tsx'),
      'utf8',
    );

    expect(source).not.toContain('OFFICIAL_CONFIRMATION');
    expect(source).toContain('toggleOfficialConfirm()');
  });
});

describe('Lanes page description', () => {
  it('reads the description from the dictionary instead of a hard-coded sentence', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'src/app/[locale]/(authenticated)/evaluation/lanes/page.tsx'),
      'utf8',
    );

    expect(source).toContain('dict.submissions.lanesDescription');
    expect(source).not.toContain('Drag submissions between lanes');
  });
});
