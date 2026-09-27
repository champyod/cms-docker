import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, findMany, requirePermission, queryRaw } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  requirePermission: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { contests: { findUnique }, participations: { findMany }, tasks: { findMany }, users: { findMany }, teams: { findMany }, $queryRaw: queryRaw } }));
vi.mock('@/lib/server/authorization', () => ({ requirePermission }));
vi.mock('@/lib/field-permissions', () => ({ filterReadableFields: (_entity: string, row: Record<string, unknown>) => row }));

import {
  getContestDetailSummary,
  getContestEditData,
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

const CONTEST_EDIT_ROW = {
  id: 7,
  name: 'Contest Seven',
  description: 'Description',
  start: new Date('2026-09-25T00:00:00.000Z'),
  stop: null,
  analysis_start: null,
  analysis_stop: null,
  timezone: 'UTC',
  allowed_localizations: [],
  languages: [],
  token_mode: 'disabled',
  token_max_number: null,
  token_gen_initial: 2,
  token_gen_number: 2,
  token_gen_max: null,
  max_submission_number: null,
  max_user_test_number: null,
  score_precision: 0,
  analysis_enabled: false,
};

describe('contest edit read model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue(new Set(['contest:read', 'contest:update']));
    findUnique.mockResolvedValue(CONTEST_EDIT_ROW);
  });

  it('carries real interval values when the interval read succeeds', async () => {
    queryRaw.mockResolvedValue([{ token_min_interval: '00:01:00', token_gen_interval: '00:30:00', min_submission_interval: null, min_user_test_interval: null }]);

    const data = await getContestEditData(7);

    expect(data?.contest).toMatchObject({ id: 7, token_min_interval: '00:01:00', token_gen_interval: '00:30:00' });
  });

  it('degrades a failed interval read to null intervals instead of failing the read', async () => {
    // Why this case: the interval columns live outside the Prisma model, so their
    // read is raw SQL over a CMS-created table. Any failure there must not take
    // down the four cosmetic fields the rest of the edit form still needs.
    queryRaw.mockRejectedValue(new Error('column "token_min_interval" does not exist'));

    const data = await getContestEditData(7);

    expect(data?.contest).toMatchObject({
      id: 7,
      name: 'Contest Seven',
      timezone: 'UTC',
      token_min_interval: null,
      token_gen_interval: null,
      min_submission_interval: null,
      min_user_test_interval: null,
    });
  });

  it('still reports a missing contest as null when the interval read fails', async () => {
    findUnique.mockResolvedValue(null);
    queryRaw.mockRejectedValue(new Error('connection reset'));

    expect(await getContestEditData(404)).toBeNull();
  });
});
