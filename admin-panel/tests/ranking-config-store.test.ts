import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the prisma mock: what these assert is the shown set the whole ranking agrees on — which
// rows the read takes, and that a config the board cannot draw is refused rather than skipped —
// so the read is observed rather than exercised against a database.
const { configFindMany } = vi.hoisted(() => ({ configFindMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { ranking_config: { findMany: configFindMany } },
}));

import { loadShownContestIds, readActiveConfigRows } from '@/lib/ranking-config-store';

function row(overrides: Partial<{ id: bigint; target_kind: string; target_key: string }>): unknown {
  return {
    id: BigInt(1),
    target_kind: 'contest',
    target_key: '9',
    reason: 'day two',
    created_at: new Date('2026-10-16T01:00:00Z'),
    created_by: 3,
    ...overrides,
  };
}

beforeEach(() => {
  configFindMany.mockReset();
});

describe('readActiveConfigRows', () => {
  it('reads the live rows only, newest first', async () => {
    configFindMany.mockResolvedValue([row({})]);

    await readActiveConfigRows();

    expect(configFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, orderBy: { id: 'desc' } }),
    );
  });
});

describe('loadShownContestIds', () => {
  it('returns the contests the board shows', async () => {
    configFindMany.mockResolvedValue([row({ target_key: '9' }), row({ target_key: '7' })]);

    await expect(loadShownContestIds()).resolves.toEqual(new Set([9, 7]));
  });

  it('refuses a target kind the board could not draw, rather than skipping it', async () => {
    configFindMany.mockResolvedValue([row({ target_kind: 'task' })]);

    await expect(loadShownContestIds()).rejects.toThrow(/cannot draw/);
  });

  it('refuses a contest key that is not an id, rather than dropping it', async () => {
    configFindMany.mockResolvedValue([row({ target_key: 'posn-oct' })]);

    await expect(loadShownContestIds()).rejects.toThrow(/not a contest id/);
  });

  it('is empty when the config shows nothing — the board draws nothing', async () => {
    configFindMany.mockResolvedValue([]);

    await expect(loadShownContestIds()).resolves.toEqual(new Set());
  });
});
