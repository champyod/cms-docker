import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mGet: vi.fn() }));

vi.mock('redis', () => ({
  createClient: () => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    mGet: mocks.mGet,
    quit: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { loadRankingIdentities } from '@/lib/login-lockouts';

const DIGEST = 'a'.repeat(64);
const COUNTER = `cms:ranking:login:${DIGEST}|5.6.7.8`;
const METADATA = `cms:ranking:login-meta:${DIGEST}|5.6.7.8`;

describe('ranking lockout identities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads one metadata value per hashed account counter', async () => {
    mocks.mGet.mockResolvedValue(['{"username":"bob","ip":"5.6.7.8"}']);

    await expect(loadRankingIdentities('redis://store', [COUNTER])).resolves.toEqual(
      new Map([[COUNTER, { username: 'bob', ip: '5.6.7.8' }]]),
    );
    expect(mocks.mGet).toHaveBeenCalledWith([METADATA]);
  });

  it('does not open Redis when every key is an address bucket or another surface', async () => {
    await expect(
      loadRankingIdentities('redis://store', ['cms:ranking:login:ip#5.6.7.8', 'cms:login:ada|5.6.7.8']),
    ).resolves.toEqual(new Map());
    expect(mocks.mGet).not.toHaveBeenCalled();
  });

  it('leaves a malformed value out so the caller can fall back to the raw key', async () => {
    mocks.mGet.mockResolvedValue(['not-json']);

    await expect(loadRankingIdentities('redis://store', [COUNTER])).resolves.toEqual(new Map());
  });
});
