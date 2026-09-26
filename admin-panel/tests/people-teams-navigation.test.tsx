// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { buildRoute } from '@/lib/navigation/routes';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { TeamList } from '@/components/teams/TeamList';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/people/teams',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/actions/teams', () => ({ deleteTeam: vi.fn() }));

const mockPush = vi.fn();

const TEAM_ROW = {
  id: 4,
  code: 'THA-01',
  name: 'Thailand Team 1',
  organization: 'MWIT',
  leaderId: 17,
  leader: { id: 17, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
  participationCount: 2,
};

function renderList(permissionKeys: readonly string[]) {
  return render(
    <DictionaryProvider dict={en}>
      <TeamList
        initialTeams={[TEAM_ROW]}
        permissionKeys={permissionKeys}
        navigation={en.navigation}
      />
    </DictionaryProvider>,
  );
}

describe('team list canonical navigation', () => {
  it('routes a desktop row activation to the record built with the frozen builder', () => {
    mockPush.mockClear();
    const { container } = renderList(['team:list']);

    const row = container.querySelector('tbody tr');
    const cell = row?.querySelector('td:nth-child(3)');
    if (!row || !cell) throw new Error('Missing desktop team row');
    fireEvent.click(cell);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(buildRoute('en', 'people.team-record', { id: TEAM_ROW.id }));
  });

  it('routes a mobile view action to the same canonical record', () => {
    mockPush.mockClear();
    const { container } = renderList(['team:list']);

    const viewLink = [...container.querySelectorAll('a')]
      .find((anchor) => anchor.getAttribute('href') === buildRoute('en', 'people.team-record', { id: TEAM_ROW.id }));
    if (!viewLink) throw new Error('Missing mobile view action');
    fireEvent.click(viewLink);

    expect(viewLink.getAttribute('href')).toBe('/en/people/teams/4');
  });

  it('renders the desktop view action as one anchor with no nested control', () => {
    const { container } = renderList(['team:list']);

    const recordHref = buildRoute('en', 'people.team-record', { id: TEAM_ROW.id });
    const desktopAction = container.querySelector(`tbody tr a[href="${recordHref}"]`);
    if (!desktopAction) throw new Error('Missing desktop view action');

    // Why: an anchor wrapping a real button announces as two controls, so the
    // row action must be the anchor itself with the shortcut marker on it.
    expect(desktopAction.querySelector('button')).toBeNull();
    expect(desktopAction.getAttribute('data-shortcut-primary')).toBe('true');
    expect(desktopAction.getAttribute('aria-label')).toBe('View team members');
  });

  it('keeps the edit action from activating the row and opens the team dialog', () => {
    mockPush.mockClear();
    const { container } = renderList(['team:list', 'team:update']);

    const row = container.querySelector('tbody tr');
    const editButton = [...(row?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === 'Edit team' || button.textContent?.includes('Edit team'));
    if (!editButton) throw new Error('Missing desktop edit action');
    fireEvent.click(editButton);

    expect(mockPush).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Edit Team');
  });
});
