// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { buildEntitySearchers, type EntityHit } from '@/components/palette/entity-searchers';
import { buildRoute } from '@/lib/navigation/routes';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { UserList } from '@/components/users/UserList';
import { UserTable } from '@/components/users/UserTable';
import { apiClient } from '@/lib/apiClient';
import type { UsersPageRow } from '@/lib/prisma-selects';

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
  it('resolves a user hit to the canonical record without the locale segment', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      users: [{ id: 17, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' }],
    } as never);

    const [hit] = await hitsFor('en');

    expect(hit.path).toBe('/people/users/17');
    expect(hit.path).not.toContain('/en/en');
    // Why: the palette and the shortcut handler prepend the locale themselves,
    // so a locale-prefixed hit would resolve to /en/en/people/users/17.
    expect(`/${'en'}${hit.path}`).toBe(buildRoute('en', 'people.user-record', { id: 17 }));
  });

  it('keeps the hit path locale-relative for every supported locale', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      users: [{ id: 17, username: 'ada', first_name: 'Ada', last_name: 'Lovelace' }],
    } as never);

    for (const locale of ['en', 'th'] as const) {
      const [hit] = await hitsFor(locale);
      expect(hit.path).toBe('/people/users/17');
    }
  });
});

describe('user list row navigation', () => {
  it('navigates to the canonical record for a reader without user:update', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <UserTable
        users={[USER_ROW]}
        loading={false}
        selectedIds={new Set()}
        canManageUsers={false}
        pageNumber={1}
        perPage={20}
        onToggleAll={vi.fn()}
        onToggleOne={vi.fn()}
        onOpen={onOpen}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
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
      <UserTable
        users={[USER_ROW]}
        loading={false}
        selectedIds={new Set()}
        canManageUsers={false}
        pageNumber={1}
        perPage={20}
        onToggleAll={vi.fn()}
        onToggleOne={onToggleOne}
        onOpen={onOpen}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
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
