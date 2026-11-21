import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  overrides: vi.fn(),
  admins: vi.fn(),
  ensurePermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_overrides: { findMany: mocks.overrides },
    admins: { findMany: mocks.admins },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));

import { getRankingOverrides } from '@/app/actions/rankingOverrides';

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: BigInt(7),
    contest_id: 9,
    target_kind: 'user',
    target_key: 'ada',
    action: 'hide',
    payload: null,
    reason: 'test account',
    created_at: new Date('2026-10-15T00:00:00.000Z'),
    created_by: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.overrides.mockResolvedValue([]);
  mocks.admins.mockResolvedValue([]);
});

describe('getRankingOverrides attribution', () => {
  it('carries the author the row records', async () => {
    mocks.overrides.mockResolvedValue([row()]);
    mocks.admins.mockResolvedValue([{ id: 3, username: 'root' }]);

    const [only] = await getRankingOverrides();

    expect(only.createdBy).toBe(3);
    expect(only.createdByName).toBe('root');
  });

  it('keeps a row written outside the panel marked as having no author', async () => {
    mocks.overrides.mockResolvedValue([row({ created_by: null })]);

    const [only] = await getRankingOverrides();

    expect(only.createdBy).toBeNull();
    expect(only.createdByName).toBeNull();
    // Nothing to look up, so the list is not asked about an admin that cannot exist.
    expect(mocks.admins).not.toHaveBeenCalled();
  });

  it('keeps the id when the admin row is gone, so the row stays attributed to someone', async () => {
    mocks.overrides.mockResolvedValue([row({ created_by: 42 })]);
    mocks.admins.mockResolvedValue([]);

    const [only] = await getRankingOverrides();

    expect(only.createdBy).toBe(42);
    expect(only.createdByName).toBeNull();
  });
});
