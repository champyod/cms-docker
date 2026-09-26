import { describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';
import { notFound } from 'next/navigation';
import { buildUserTabs } from '@/app/[locale]/(authenticated)/people/users/[id]/layout';
import LegacyUsersPage from '@/app/[locale]/(authenticated)/users/page';
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
  getUserSummary: vi.fn(),
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn() }));

const USER_RECORD_READER: readonly string[] = [
  'user:read',
  'participation:list',
  'team:read',
  'submission:read',
];

describe('User record tab rail', () => {
  it('offers all three tabs in registry order to a complete reader', () => {
    const tabs = buildUserTabs('en', 17, new Set(USER_RECORD_READER), en);
    expect(tabs.map((tab) => tab.id)).toEqual([
      'people.user-tabs.profile',
      'people.user-tabs.teams',
      'people.user-tabs.history',
    ]);
  });

  it('builds every tab href with the frozen builder and the record id', () => {
    const tabs = buildUserTabs('th', 17, new Set(USER_RECORD_READER), en);
    expect(tabs.map((tab) => tab.href)).toEqual([
      '/th/people/users/17/profile',
      '/th/people/users/17/teams',
      '/th/people/users/17/history',
    ]);
  });

  it('omits a tab entirely when a required key is missing', () => {
    const withoutTeamRead = USER_RECORD_READER.filter((key) => key !== 'team:read');
    const tabs = buildUserTabs('en', 17, new Set(withoutTeamRead), en);
    expect(tabs.map((tab) => tab.id)).toEqual(['people.user-tabs.profile', 'people.user-tabs.history']);
  });

  it('conceals the whole rail from a caller without user:read', () => {
    expect(() => buildUserTabs('en', 17, new Set(['participation:list', 'team:read']), en))
      .toThrow('NEXT_NOT_FOUND');
  });

  it('exposes the three tab descriptors as enabled registry routes', () => {
    const enabledIds = ROUTE_REGISTRY
      .filter((route) => route.id.startsWith('people.user'))
      .filter((route) => route.enabled)
      .map((route) => route.id);
    expect(enabledIds).toEqual([
      'people.users',
      'people.user-record',
      'people.user-tabs.profile',
      'people.user-tabs.teams',
      'people.user-tabs.history',
    ]);
  });
});

describe('legacy /users redirect', () => {
  it('renders the concealed view when the caller lacks user:list', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(403));
    await expect(
      LegacyUsersPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('renders the concealed view when the caller can read no People route', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['task:list']));
    await expect(
      LegacyUsersPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('falls back inside the People group for a denied legacy target', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['team:list']));
    await expect(
      LegacyUsersPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/en/people/teams');
  });

  it('redirects a permitted caller to the locale-preserving canonical page', async () => {
    vi.mocked(requirePermission).mockResolvedValue(new Set(['user:list']));
    await expect(
      LegacyUsersPage({ params: Promise.resolve({ locale: 'th' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/th/people/users');
  });
});
