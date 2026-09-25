import { describe, expect, it, vi } from 'vitest';
import { getUserHistory, getUserSummary } from '@/lib/people-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { requirePermission } from '@/lib/server/authorization';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { users: { findUnique: vi.fn() } },
}));

const mockRequirePermission = vi.mocked(requirePermission);

describe('People read models', () => {
  it('requires user:read before reading a user summary', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['user:read']));
    vi.mocked(prisma.users.findUnique).mockResolvedValue({
      id: 7,
      username: 'ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      status: 'active',
      organization: 'Analytical Engines',
      country: 'GB',
      _count: { participations: 2 },
      participations: [{ teams: { code: 'A-1', name: 'Alpha' } }],
    } as never);

    const result = await getUserSummary(7);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(result).toEqual({
      id: 7,
      username: 'ada',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'active',
      organization: 'Analytical Engines',
      country: 'GB',
      participationCount: 2,
      teamCodes: ['A-1'],
    });
  });

  it('omits unreadable account access and never adds a credential field to history', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['user:read', 'participation:list', 'submission:read']));
    vi.mocked(prisma.users.findUnique).mockResolvedValue({ id: 7, last_login_at: null, participations: [] } as never);

    const history = await getUserHistory(7);

    expect(mockRequirePermission).toHaveBeenCalledWith('user:read');
    expect(mockRequirePermission).toHaveBeenCalledWith('participation:list');
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(history?.accountAccess).toEqual({ lastLoginAt: null });
    expect(history).not.toHaveProperty('password');
    expect(history).not.toHaveProperty('authentication');
  });

  it('hides a People tab when one exact reader key is missing', () => {
    const cases = [
      ['people.user-tabs.teams', ['user:read', 'participation:list', 'team:read']],
      ['people.user-tabs.history', ['user:read', 'participation:list', 'submission:read']],
      ['people.team-tabs.members', ['team:read', 'participation:list', 'user:read']],
      ['people.team-tabs.contests', ['team:read', 'participation:list', 'contest:read']],
    ] as const;

    for (const [routeId, requiredKeys] of cases) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      if (!route) throw new Error(`Missing People route descriptor: ${routeId}`);
      expect(isRoutePermitted({ ...route, enabled: true }, new Set(requiredKeys))).toBe(true);
      for (const missingKey of requiredKeys) {
        const partialKeys = requiredKeys.filter((key) => key !== missingKey);
        expect(isRoutePermitted({ ...route, enabled: true }, new Set(partialKeys))).toBe(false);
      }
    }
  });
});
