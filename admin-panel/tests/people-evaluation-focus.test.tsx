// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import en from '@/dictionaries/en.json';
import { Button } from '@/components/core/Button';
import { DetailSurface } from '@/components/core/DetailSurface';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { Loading as LoadingState } from '@/components/core/Loading';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { TeamList } from '@/components/teams/TeamList';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteTab } from '@/lib/navigation/types';
import type { SubmissionListItem } from '@/types';

afterEach(() => cleanup());

let pathname = '/en/people/teams/4/overview';
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const TEAM_TABS: readonly RouteTab[] = [
  { id: 'people.team-tabs.overview', label: 'Overview', href: '/en/people/teams/4/overview' },
  { id: 'people.team-tabs.members', label: 'Members', href: '/en/people/teams/4/members' },
  { id: 'people.team-tabs.contests', label: 'Contests', href: '/en/people/teams/4/contests' },
];

const TEAM_ROW = {
  id: 4,
  code: 'THA-01',
  name: 'Thailand Team 1',
  organization: 'MWIT',
  leaderId: 17,
  leader: { id: 17, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
  participationCount: 2,
};

const SUBMISSION_ROW = {
  id: 19,
  timestamp: new Date('2026-01-15T08:30:00Z'),
  language: 'cpp',
  official: false,
  comment: '',
  participations: { users: { username: 'ada' }, contests: { name: 'Practice Round' }, teams: null },
  tasks: { name: 'Sum' },
  submission_results: [{ score: 42, compilation_outcome: 'ok', evaluation_outcome: 'ok' }],
} as unknown as SubmissionListItem;

function tabLink(label: string): HTMLAnchorElement {
  const link = [...document.querySelectorAll('a')].find((anchor) => anchor.textContent === label);
  if (!link) throw new Error(`Missing tab link: ${label}`);
  return link;
}

function renderTeamList(): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <TeamList
        initialTeams={[TEAM_ROW]}
        permissionKeys={['team:list']}
        navigation={en.navigation}
        copy={en.teams}
        docsTitle={en.docs.title}
      />
    </DictionaryProvider>,
  );
  return container;
}

describe('row Enter navigation on a canonical People list', () => {
  it('opens the record built by the frozen route builder', () => {
    mockPush.mockClear();
    const container = renderTeamList();
    const row = container.querySelector('tbody tr');
    if (!row) throw new Error('Missing desktop team row');

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(buildRoute('en', 'people.team-record', { id: TEAM_ROW.id }));
  });
});

describe('row Enter navigation on a canonical Evaluation list', () => {
  it('opens the submission record rather than the removed modal', () => {
    mockPush.mockClear();
    const { container } = render(
      <DictionaryProvider dict={en}>
        <SubmissionList
          initialSubmissions={[SUBMISSION_ROW]}
          totalPages={1}
          currentPage={1}
          navigation={en.navigation}
        />
      </DictionaryProvider>,
    );
    const row = container.querySelector('tbody tr');
    if (!row) throw new Error('Missing desktop submission row');

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(buildRoute('en', 'evaluation.submission-record', { id: 19 }));
  });
});

describe('tab link focus across a record route transition', () => {
  it('keeps the activated tab link focused while the record layout stays mounted', () => {
    pathname = '/en/people/teams/4/overview';
    const { rerender } = render(
      <DictionaryProvider dict={en}>
        <DetailSurface breadcrumbs={[{ label: 'Team' }]} title="Thailand Team 1" tabs={TEAM_TABS}>
          <div>Overview body</div>
        </DetailSurface>
      </DictionaryProvider>,
    );
    const members = tabLink('Members');
    members.focus();
    expect(document.activeElement).toBe(members);

    pathname = '/en/people/teams/4/members';
    rerender(
      <DictionaryProvider dict={en}>
        <DetailSurface breadcrumbs={[{ label: 'Team' }]} title="Thailand Team 1" tabs={TEAM_TABS}>
          <div>Members body</div>
        </DetailSurface>
      </DictionaryProvider>,
    );

    expect(document.activeElement).toBe(members);
    expect(members.getAttribute('aria-current')).toBe('page');
  });
});

describe('focus when a nested tab loading boundary completes', () => {
  it('does not move focus off the tab link when the fallback is replaced by content', () => {
    pathname = '/en/people/teams/4/members';
    function TabBody({ pending }: { readonly pending: boolean }): React.JSX.Element {
      return pending ? <LoadingState text={en.states.loading.teamMembers} /> : <div>Members body</div>;
    }
    const { rerender } = render(
      <DictionaryProvider dict={en}>
        <DetailSurface breadcrumbs={[{ label: 'Team' }]} title="Thailand Team 1" tabs={TEAM_TABS}>
          <TabBody pending />
        </DetailSurface>
      </DictionaryProvider>,
    );
    const members = tabLink('Members');
    members.focus();

    rerender(
      <DictionaryProvider dict={en}>
        <DetailSurface breadcrumbs={[{ label: 'Team' }]} title="Thailand Team 1" tabs={TEAM_TABS}>
          <TabBody pending={false} />
        </DetailSurface>
      </DictionaryProvider>,
    );

    expect(document.body.textContent).toContain('Members body');
    expect(document.activeElement).toBe(members);
  });
});

function InvokerHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <DictionaryProvider dict={en}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Move lane</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Move lane" description="Recorded with its reason.">
        <div>Lane selector</div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </Dialog>
    </DictionaryProvider>
  );
}

function control(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`Missing control: ${label}`);
  return button;
}

describe('dialog close focus restoration', () => {
  it('returns focus to the control that opened the dialog', async () => {
    render(<InvokerHarness />);
    const invoker = control('Move lane');
    invoker.focus();

    fireEvent.click(invoker);
    expect(document.body.textContent).toContain('Lane selector');

    fireEvent.click(control('Close'));

    // Why waitFor: the focus scope restores focus from its unmount cleanup, so
    // the hand-back lands one microtask turn after the dialog leaves the DOM.
    await waitFor(() => expect(document.activeElement).toBe(invoker));
  });
});
