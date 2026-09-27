// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { buildEntitySearchers, type EntityHit } from '@/components/palette/entity-searchers';
import { buildRoute } from '@/lib/navigation/routes';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { UserList } from '@/components/users/UserList';
import { UserTable } from '@/components/users/UserTable';
import { activateSelectedRow } from '@/hooks/shortcut-rows';
import { apiClient } from '@/lib/apiClient';
import type { UsersPageRow } from '@/lib/prisma-selects';

/** Why: the cluster only counts as migrated while every action keeps the 44px target. */
function expectTouchTarget(button: Element): void {
  expect(button.className).toContain('h-11');
  expect(button.className).toContain('w-11');
}

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; without it, later row queries
// would bind to the accumulated document.body.
afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/people/users',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/actions/contests', () => ({ getContests: vi.fn() }));
vi.mock('@/app/actions/tasks', () => ({ getTasks: vi.fn() }));
vi.mock('@/app/actions/teams', () => ({ getTeams: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn() } }));

const mockPush = vi.fn();

const USER_ROW = {
  id: 17,
  username: 'ada',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  status: 'active',
  organization: 'MWIT',
  country: 'TH',
  _count: { participations: 2 },
  participations: [],
} as unknown as UsersPageRow;

async function hitsFor(locale: string): Promise<EntityHit[]> {
  const searcher = buildEntitySearchers({ contests: false, tasks: false, users: true }, locale)
    .find((candidate) => candidate.length > 0);
  if (!searcher) throw new Error('Missing entity searcher for the users surface');
  return searcher('ada', new AbortController().signal);
}

describe('command palette entity hits', () => {
  it('resolves a user hit to the canonical record href', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      users: [{ id: 17, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' }],
    } as never);

    const [hit] = await hitsFor('en');

    // Why the full href: the palette receives a ready-to-push href from the single
    // route builder, so a hit is the canonical URL rather than a path the caller
    // must prefix — a second prefix here is what produced /en/en/....
    expect(hit.path).toBe(buildRoute('en', 'people.user-record', { id: 17 }));
    expect(hit.path).toBe('/en/people/users/17');
    expect(hit.path).not.toContain('/en/en');
  });

  it('builds the hit href from the requested locale', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      users: [{ id: 17, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' }],
    } as never);

    for (const locale of ['en', 'th'] as const) {
      const [hit] = await hitsFor(locale);
      expect(hit.path).toBe(buildRoute(locale, 'people.user-record', { id: 17 }));
    }
  });
});

describe('user list row navigation', () => {
  it('navigates to the canonical record for a reader without user:update', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <DictionaryProvider dict={en}>
        <UserTable
          users={[USER_ROW]}
          loading={false}
          selectedIds={new Set()}
          permissionKeys={[]}
          pageNumber={1}
          perPage={20}
          onToggleAll={vi.fn()}
          onToggleOne={vi.fn()}
          onOpen={onOpen}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </DictionaryProvider>,
    );

    const row = container.querySelector('tbody tr');
    const cell = row?.querySelector('td:nth-child(4) span');
    if (!row || !cell) throw new Error('Missing desktop user row');
    fireEvent.click(cell);

    expect(onOpen).toHaveBeenCalledWith(USER_ROW);
  });

  it('keeps the select checkbox from opening the record', () => {
    const onOpen = vi.fn();
    const onToggleOne = vi.fn();
    const { container } = render(
      <DictionaryProvider dict={en}>
        <UserTable
          users={[USER_ROW]}
          loading={false}
          selectedIds={new Set()}
          permissionKeys={[]}
          pageNumber={1}
          perPage={20}
          onToggleAll={vi.fn()}
          onToggleOne={onToggleOne}
          onOpen={onOpen}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </DictionaryProvider>,
    );

    const checkbox = container.querySelector<HTMLInputElement>('tbody tr input[type="checkbox"]');
    if (!checkbox) throw new Error('Missing row select checkbox');
    fireEvent.click(checkbox);

    expect(onToggleOne).toHaveBeenCalledWith(17, true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('routes the list row to the record built with the frozen builder', () => {
    mockPush.mockClear();
    const { container } = render(
      <DictionaryProvider dict={en}>
        <UserList
          initialUsers={[USER_ROW]}
          totalPages={1}
          currentPage={1}
          perPage={20}
          initialSearch=""
          contests={[]}
          canReadContests={false}
          navigation={en.navigation}
          permissionKeys={['user:list', 'user:read']}
          locale="en"
        />
      </DictionaryProvider>,
    );

    const row = container.querySelector('tbody tr');
    const cell = row?.querySelector('td:nth-child(3) span');
    if (!row || !cell) throw new Error('Missing desktop user row');
    fireEvent.click(cell);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(buildRoute('en', 'people.user-record', { id: USER_ROW.id }));
  });
});

describe('user list row action cluster', () => {
  function renderUserTable(onEdit: (user: UsersPageRow) => void, onDelete: (id: number) => void, permissionKeys: readonly string[] = ['user:update', 'user:delete']): void {
    render(
      <DictionaryProvider dict={en}>
        <UserTable
          users={[USER_ROW]}
          loading={false}
          selectedIds={new Set()}
          permissionKeys={permissionKeys}
          pageNumber={1}
          perPage={20}
          onToggleAll={vi.fn()}
          onToggleOne={vi.fn()}
          onOpen={vi.fn()}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </DictionaryProvider>,
    );
  }

  it('keeps 44px targets and marks edit, not delete, as the shortcut primary', () => {
    renderUserTable(vi.fn(), vi.fn());
    // Why both: the table renders the mobile card and the desktop row, so one record owns two clusters.
    const edits = screen.getAllByRole('button', { name: 'Edit user ada' });
    const removes = screen.getAllByRole('button', { name: 'Delete user ada' });
    expect(edits).toHaveLength(2);
    for (const edit of edits) {
      expectTouchTarget(edit);
      expect(edit.getAttribute('data-shortcut-primary')).toBe('true');
    }
    for (const remove of removes) {
      expectTouchTarget(remove);
      expect(remove.hasAttribute('data-shortcut-primary')).toBe(false);
    }
  });

  // Why: the cluster used to sit behind one user:update flag, so a delete-only reader saw
  // no controls at all. Each action now carries the permission its own server route demands.
  it('gates edit and delete on their own keys rather than one shared flag', () => {
    renderUserTable(vi.fn(), vi.fn(), ['user:delete']);
    expect(screen.queryByRole('button', { name: 'Edit user ada' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Delete user ada' })).toHaveLength(2);
    cleanup();
    renderUserTable(vi.fn(), vi.fn(), ['user:update']);
    expect(screen.getAllByRole('button', { name: 'Edit user ada' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Delete user ada' })).toBeNull();
  });

  // Why the marker and the press are both asserted: the marker is what
  // findPrimaryAction queries for, so losing it is what silently reroutes Enter.
  it('activates the edit action when Enter reaches a selected row', () => {
    mockPush.mockClear();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderUserTable(onEdit, onDelete);
    const preventDefault = vi.fn();
    const row = document.querySelector<HTMLElement>('[data-shortcut-row="17"]');
    if (!row) throw new Error('Missing shortcut row');

    activateSelectedRow({ key: 'Enter', target: row, preventDefault }, { current: 0 });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
