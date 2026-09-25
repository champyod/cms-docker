import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import PeopleUsersPage from '@/app/[locale]/(authenticated)/people/users/page';
import { getUsers } from '@/app/actions/users';
import { UserList } from '@/components/users/UserList';
import { prisma } from '@/lib/prisma';

vi.mock('@/app/actions/users', () => ({ getUsers: vi.fn() }));
vi.mock('@/components/users/UserList', () => ({ UserList: vi.fn(() => null) }));
vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => ({ users: { title: 'Users', subtitle: 'Manage users' } })) }));
vi.mock('@/lib/prisma', () => ({ prisma: { contests: { findMany: vi.fn() } } }));

const mockGetUsers = vi.mocked(getUsers);
const mockUserList = vi.mocked(UserList);
const mockFindMany = vi.mocked(prisma.contests.findMany);

it('does not query or serialize contests for user:list-only callers', async () => {
  mockGetUsers.mockResolvedValue({
    users: [],
    totalPages: 1,
    currentPage: 1,
    perPage: 20,
    total: 0,
    effectivePermissions: new Set(['user:list']),
  });

  // Why: the page returns an element tree, so the mocked UserList only runs once
  // React actually renders it.
  const tree = await PeopleUsersPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({ page: '1', search: '', perPage: '20' }),
  });
  renderToStaticMarkup(tree);

  expect(mockFindMany).not.toHaveBeenCalled();
  expect(mockUserList).toHaveBeenCalledTimes(1);
  const props = mockUserList.mock.calls[0][0];
  expect(props.contests).toEqual([]);
  expect(props.canReadContests).toBe(false);
  expect(JSON.stringify(props)).not.toContain('Contest A');
});
