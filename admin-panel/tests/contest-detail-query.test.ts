import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, findMany, requirePermission } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { contests: { findUnique }, participations: { findMany }, tasks: { findMany }, users: { findMany }, teams: { findMany } } }));
vi.mock('@/lib/server/authorization', () => ({ requirePermission }));
vi.mock('@/lib/field-permissions', () => ({ filterReadableFields: (_entity: string, row: Record<string, unknown>) => row }));

import {
  getContestDetailSummary,
  getContestParticipants,
} from '@/lib/queries/contest-detail';

describe('contest detail read models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue(new Set(['contest:read', 'participation:read', 'user:read']));
    findUnique.mockResolvedValue({
      id: 7,
      name: 'Contest Seven',
      description: 'Description',
      is_active: true,
      start: new Date('2026-09-25T00:00:00.000Z'),
      stop: null,
      analysis_start: null,
      analysis_stop: null,
      participations: [{ password: 'must-not-leak' }],
    });
  });

  it('rejects a missing session through the shared permission contract', async () => {
    requirePermission.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    await expect(getContestDetailSummary(7)).rejects.toMatchObject({ status: 401 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a missing permission with the required key', async () => {
    requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403, permission: 'contest:read' }));
    await expect(getContestDetailSummary(7)).rejects.toMatchObject({ status: 403, permission: 'contest:read' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns only the summary projection and no Contest relations', async () => {
    const result = await getContestDetailSummary(7);
    expect(result).toMatchObject({ id: 7, name: 'Contest Seven', is_active: true });
    expect(result).not.toHaveProperty('participations');
    expect(result).not.toHaveProperty('tasks');
    expect(findUnique.mock.calls[0][0].select).toEqual(expect.objectContaining({ id: true, name: true, description: true, is_active: true }));
  });

  it('rejects the participant reader when user:read is missing', async () => {
    requirePermission.mockImplementation(async (permission: string) => {
      if (permission === 'user:read') {
        throw Object.assign(new Error('Forbidden'), { status: 403, permission });
      }
      return new Set(['contest:read', 'participation:read']);
    });

    await expect(getContestParticipants(7)).rejects.toMatchObject({
      status: 403,
      permission: 'user:read',
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
