import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { services: { findMany: mocks.findMany } },
}));

import {
  DEFAULT_EVALUATION_ENDPOINT,
  EvaluationTargetError,
  resolveEvaluationEndpoint,
} from '@/lib/evaluation-endpoint';

function row(contest_id: number | null, host: string, rpc_port: number | null = 25000) {
  return { host, rpc_port, contest_id };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveEvaluationEndpoint', () => {
  it('falls back to the compose service when the registry is empty', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await resolveEvaluationEndpoint(1)).toEqual(DEFAULT_EVALUATION_ENDPOINT);
  });

  it('uses the shared row for any contest', async () => {
    mocks.findMany.mockResolvedValue([row(null, 'cms-evaluation-service', 25000)]);
    expect(await resolveEvaluationEndpoint(9)).toEqual({ host: 'cms-evaluation-service', port: 25000 });
  });

  it('prefers the row bound to the contest over the shared one', async () => {
    mocks.findMany.mockResolvedValue([
      row(null, 'shared-eval', 25000),
      row(4, 'eval-for-4', 25001),
    ]);
    expect(await resolveEvaluationEndpoint(4)).toEqual({ host: 'eval-for-4', port: 25001 });
  });

  it('falls back to the shared row for a contest with no bound service', async () => {
    mocks.findMany.mockResolvedValue([
      row(null, 'shared-eval', 25000),
      row(4, 'eval-for-4', 25001),
    ]);
    expect(await resolveEvaluationEndpoint(7)).toEqual({ host: 'shared-eval', port: 25000 });
  });

  it('refuses when no enabled service serves the contest', async () => {
    mocks.findMany.mockResolvedValue([row(4, 'eval-for-4', 25001)]);
    await expect(resolveEvaluationEndpoint(7)).rejects.toThrow(EvaluationTargetError);
  });

  it('refuses when no service serves every contest and no contest is named', async () => {
    mocks.findMany.mockResolvedValue([row(4, 'eval-for-4', 25001)]);
    await expect(resolveEvaluationEndpoint(null)).rejects.toThrow(EvaluationTargetError);
  });

  it('refuses a service with no rpc port rather than dialling zero', async () => {
    mocks.findMany.mockResolvedValue([row(null, 'cms-evaluation-service', null)]);
    await expect(resolveEvaluationEndpoint(1)).rejects.toThrow(/rpc_port/);
  });

  it('asks only for enabled evaluation services, in shard order', async () => {
    mocks.findMany.mockResolvedValue([]);
    await resolveEvaluationEndpoint(1);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'EvaluationService', enabled: true },
        orderBy: { shard: 'asc' },
      })
    );
  });
});
