import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertService: vi.fn(),
  deleteService: vi.fn(),
  upsertWiring: vi.fn(),
  upsertExposure: vi.fn(),
  findManyServices: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    services: { upsert: mocks.upsertService, delete: mocks.deleteService, findMany: mocks.findManyServices },
    wirings: { upsert: mocks.upsertWiring, findMany: vi.fn() },
    contest_exposures: { upsert: mocks.upsertExposure, findMany: vi.fn() },
  },
}));

import { saveService, saveWiring } from '@/lib/service-wiring-store';
import type { ServiceInput } from '@/lib/service-wiring-contract';

function service(overrides: Partial<ServiceInput> = {}): ServiceInput {
  return {
    name: 'cms-contest-web-server-1',
    role: 'ContestWebServer',
    shard: 0,
    host: 'web-1',
    http_port: 8888,
    rpc_port: 21000,
    db_profile: 'default',
    contest_id: 1,
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertService.mockResolvedValue({ id: 1 });
});

describe('saveService', () => {
  it('accepts a well-formed service and upserts by name', async () => {
    expect(await saveService(service())).toEqual({ success: true });
    expect(mocks.upsertService).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unsafe host', { host: 'web-1; root /etc;' }],
    ['an unknown role', { role: 'NotARole' as ServiceInput['role'] }],
    ['no port at all', { http_port: null, rpc_port: null }],
    ['a port above the ceiling', { http_port: 70000 }],
    ['an empty name', { name: '  ' }],
    ['an empty db_profile', { db_profile: ' ' }],
    ['a negative shard', { shard: -1 }],
  ])('refuses %s without touching the database', async (_label, overrides) => {
    const result = await saveService(service(overrides));
    expect(result.success).toBe(false);
    expect(mocks.upsertService).not.toHaveBeenCalled();
  });

  it('allows a service with only an rpc port', async () => {
    expect(await saveService(service({ http_port: null }))).toEqual({ success: true });
  });
});

describe('saveWiring', () => {
  it('refuses a self-link', async () => {
    const result = await saveWiring({ from_service_id: 2, to_service_id: 2, relation: 'drains', enabled: true });
    expect(result.success).toBe(false);
    expect(mocks.upsertWiring).not.toHaveBeenCalled();
  });

  it('refuses an empty relation', async () => {
    const result = await saveWiring({ from_service_id: 1, to_service_id: 2, relation: '  ', enabled: true });
    expect(result.success).toBe(false);
    expect(mocks.upsertWiring).not.toHaveBeenCalled();
  });
});
