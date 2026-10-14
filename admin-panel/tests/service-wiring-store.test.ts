import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  createWiring: vi.fn(),
  updateWiring: vi.fn(),
  createExposure: vi.fn(),
  updateExposure: vi.fn(),
  findManyServices: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    services: {
      create: mocks.createService,
      update: mocks.updateService,
      delete: mocks.deleteService,
      findMany: mocks.findManyServices,
    },
    wirings: { create: mocks.createWiring, update: mocks.updateWiring, findMany: vi.fn() },
    contest_exposures: { create: mocks.createExposure, update: mocks.updateExposure, findMany: vi.fn() },
  },
}));

import { saveExposure, saveService, saveWiring } from '@/lib/service-wiring-store';
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

const UNIQUE_VIOLATION = { code: 'P2002' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createService.mockResolvedValue({ id: 1 });
  mocks.updateService.mockResolvedValue({ id: 1 });
  mocks.createWiring.mockResolvedValue({ id: 1 });
  mocks.updateWiring.mockResolvedValue({ id: 1 });
  mocks.createExposure.mockResolvedValue({ id: 1 });
  mocks.updateExposure.mockResolvedValue({ id: 1 });
});

describe('saveService', () => {
  it('accepts a well-formed service and creates it', async () => {
    expect(await saveService(service())).toEqual({ success: true });
    expect(mocks.createService).toHaveBeenCalledTimes(1);
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('updates the named row in place when the input carries an id', async () => {
    expect(await saveService(service({ id: 7, name: 'renamed' }))).toEqual({ success: true });
    expect(mocks.updateService).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ name: 'renamed' }),
    });
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  it('refuses a create that collides with an existing name', async () => {
    mocks.createService.mockRejectedValue(UNIQUE_VIOLATION);
    const result = await saveService(service());
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
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
    expect(mocks.createService).not.toHaveBeenCalled();
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('allows a service with only an rpc port', async () => {
    expect(await saveService(service({ http_port: null }))).toEqual({ success: true });
  });
});

describe('saveExposure', () => {
  it.each(['../escape', 'a/b', 'UPPER node', '-leading'])(
    'refuses the tailnet name %j before the database sees it',
    async (tailnet) => {
      const result = await saveExposure({ contest_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet });
      expect(result.success).toBe(false);
      expect(mocks.createExposure).not.toHaveBeenCalled();
    }
  );

  it('accepts a single-label node name', async () => {
    const result = await saveExposure({ contest_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: 'cms-7' });
    expect(result).toEqual({ success: true });
  });

  it.each(['/beta/', '/beta'])('stores %j as the one normalised location', async (path) => {
    expect(await saveExposure({ contest_id: 1, hostname: 'a.example.com', path, tls: true, tailnet: null })).toEqual({
      success: true,
    });
    expect(mocks.createExposure).toHaveBeenCalledWith({
      data: expect.objectContaining({ hostname: 'a.example.com', path: '/beta' }),
    });
  });

  it('updates the named row in place when the input carries an id', async () => {
    const result = await saveExposure({ id: 9, contest_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: null });
    expect(result).toEqual({ success: true });
    expect(mocks.updateExposure).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ contest_id: 1 }),
    });
    expect(mocks.createExposure).not.toHaveBeenCalled();
  });

  it('refuses a create that collides with an existing location', async () => {
    mocks.createExposure.mockRejectedValue(UNIQUE_VIOLATION);
    const result = await saveExposure({ contest_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: null });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});

describe('saveWiring', () => {
  it('refuses a self-link', async () => {
    const result = await saveWiring({ from_service_id: 2, to_service_id: 2, relation: 'drains', enabled: true });
    expect(result.success).toBe(false);
    expect(mocks.createWiring).not.toHaveBeenCalled();
  });

  it('refuses an empty relation', async () => {
    const result = await saveWiring({ from_service_id: 1, to_service_id: 2, relation: '  ', enabled: true });
    expect(result.success).toBe(false);
    expect(mocks.createWiring).not.toHaveBeenCalled();
  });

  it('updates the named row in place when the input carries an id', async () => {
    const result = await saveWiring({ id: 4, from_service_id: 1, to_service_id: 2, relation: 'drains', enabled: false });
    expect(result).toEqual({ success: true });
    expect(mocks.updateWiring).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ relation: 'drains', enabled: false }),
    });
    expect(mocks.createWiring).not.toHaveBeenCalled();
  });

  it('refuses a create that collides with an existing triple', async () => {
    mocks.createWiring.mockRejectedValue(UNIQUE_VIOLATION);
    const result = await saveWiring({ from_service_id: 1, to_service_id: 2, relation: 'drains', enabled: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});
