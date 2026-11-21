import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the mocks: what these assert is which rows the registry writes and what trail a binding
// leaves, so the writes are observed rather than exercised against a database.
const mocks = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  findService: vi.fn(),
  createWiring: vi.fn(),
  updateWiring: vi.fn(),
  createExposure: vi.fn(),
  updateExposure: vi.fn(),
  findManyServices: vi.fn(),
  findContest: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    services: {
      create: mocks.createService,
      update: mocks.updateService,
      delete: mocks.deleteService,
      findUnique: mocks.findService,
      findMany: mocks.findManyServices,
    },
    wirings: { create: mocks.createWiring, update: mocks.updateWiring, findMany: vi.fn() },
    contest_exposures: { create: mocks.createExposure, update: mocks.updateExposure, findMany: vi.fn() },
    contests: { findUnique: mocks.findContest },
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

import { bindServiceContest, saveExposure, saveService, saveWiring } from '@/lib/panel-actions';
import type { ServiceInput } from '@/lib/service-wiring-contract';

const ACTOR = 7;

/** The row a binding reads back, as the registry would carry it. */
const STORED_ROW = {
  id: 3,
  name: 'cms-contest-web-server-1',
  role: 'ContestWebServer',
  shard: 0,
  host: 'web-1',
  http_port: 8888,
  rpc_port: 21000,
  db_profile: 'default',
  enabled: true,
  image: null,
  pull_policy: 'missing',
};

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
    image: '',
    pull_policy: 'missing',
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
  mocks.findService.mockResolvedValue(STORED_ROW);
  mocks.findContest.mockResolvedValue({ id: 9 });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('saveService', () => {
  it('accepts a well-formed service and creates it', async () => {
    expect(await saveService(ACTOR, service())).toEqual({ success: true });
    expect(mocks.createService).toHaveBeenCalledTimes(1);
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('files the binding under one verb, whoever performed it', async () => {
    await saveService(ACTOR, service({ contest_id: 9 }));

    // One audit shape for the panel action and the ./cms verb: same verb, same entity, same
    // after-values, so the trail cannot read as two different actions.
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      actorId: ACTOR,
      verb: 'service-wiring:save',
      entity: 'service_registry',
      entityId: 'cms-contest-web-server-1',
      afterValues: { name: 'cms-contest-web-server-1', role: 'ContestWebServer', shard: 0, contest_id: 9 },
      result: 'success',
    });
  });

  it('files nothing when the write was refused', async () => {
    await saveService(ACTOR, service({ shard: -1 }));
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('stores the row image and keeps a blank one null', async () => {
    expect(await saveService(ACTOR, service({ image: '  ghcr.io/acme/core:v2 ' }))).toEqual({ success: true });
    expect(mocks.createService.mock.calls[0][0].data.image).toBe('ghcr.io/acme/core:v2');
    mocks.createService.mockClear();
    expect(await saveService(ACTOR, service({ image: '' }))).toEqual({ success: true });
    expect(mocks.createService.mock.calls[0][0].data.image).toBeNull();
  });

  it('refuses an image reference that could break the generated compose', async () => {
    expect(await saveService(ACTOR, service({ image: 'core:tag\n    privileged: true' }))).toMatchObject({ success: false });
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  it('refuses a pull policy compose does not accept', async () => {
    expect(await saveService(ACTOR, service({ pull_policy: 'sometimes' }))).toMatchObject({ success: false });
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  it('updates the named row in place when the input carries an id', async () => {
    expect(await saveService(ACTOR, service({ id: 7, name: 'renamed' }))).toEqual({ success: true });
    expect(mocks.updateService).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ name: 'renamed' }),
    });
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  it('refuses a create that collides with an existing name', async () => {
    mocks.createService.mockRejectedValue(UNIQUE_VIOLATION);
    const result = await saveService(ACTOR, service());
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
    ['a ProxyService with no contest', { role: 'ProxyService' as ServiceInput['role'], contest_id: null }],
  ])('refuses %s without touching the database', async (_label, overrides) => {
    const result = await saveService(ACTOR, service(overrides));
    expect(result.success).toBe(false);
    expect(mocks.createService).not.toHaveBeenCalled();
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('accepts a ProxyService that names the contest it relays', async () => {
    expect(await saveService(ACTOR, service({ role: 'ProxyService', contest_id: 8 }))).toEqual({ success: true });
  });

  it('allows a service with only an rpc port', async () => {
    expect(await saveService(ACTOR, service({ http_port: null }))).toEqual({ success: true });
  });
});

describe('bindServiceContest', () => {
  it('points the stored row at the contest its shard serves, keeping every other field', async () => {
    await bindServiceContest(ACTOR, { service: STORED_ROW.name, contestId: 9 });

    expect(mocks.updateService).toHaveBeenCalledWith({
      where: { id: STORED_ROW.id },
      data: expect.objectContaining({
        name: STORED_ROW.name,
        role: STORED_ROW.role,
        shard: STORED_ROW.shard,
        host: STORED_ROW.host,
        contest_id: 9,
      }),
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, verb: 'service-wiring:save' }),
    );
  });

  it('clears the binding when the row names no contest', async () => {
    await bindServiceContest(ACTOR, { service: STORED_ROW.name, contestId: null });
    expect(mocks.updateService).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contest_id: null }) }),
    );
  });

  it('refuses a service the registry does not carry', async () => {
    mocks.findService.mockResolvedValue(null);
    await expect(bindServiceContest(ACTOR, { service: 'ghost', contestId: 9 })).rejects.toThrow(
      'no service named ghost',
    );
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('refuses a contest the database does not carry', async () => {
    mocks.findContest.mockResolvedValue(null);
    await expect(bindServiceContest(ACTOR, { service: STORED_ROW.name, contestId: 404 })).rejects.toThrow(
      'no contest with id 404',
    );
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it('refuses a blank name instead of binding whatever it matched', async () => {
    await expect(bindServiceContest(ACTOR, { service: '   ', contestId: 9 })).rejects.toThrow(
      'a binding needs the service it names',
    );
    expect(mocks.findService).not.toHaveBeenCalled();
  });

  it('refuses clearing a row whose role must name a contest', async () => {
    mocks.findService.mockResolvedValue({ ...STORED_ROW, role: 'ProxyService' });
    await expect(bindServiceContest(ACTOR, { service: STORED_ROW.name, contestId: null })).rejects.toThrow(
      'must name the contest whose board it feeds',
    );
    expect(mocks.updateService).not.toHaveBeenCalled();
  });
});

describe('saveExposure', () => {
  it.each(['../escape', 'a/b', 'UPPER node', '-leading'])(
    'refuses the tailnet name %j before the database sees it',
    async (tailnet) => {
      const result = await saveExposure({ service_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet });
      expect(result.success).toBe(false);
      expect(mocks.createExposure).not.toHaveBeenCalled();
    }
  );

  it('accepts a single-label node name', async () => {
    const result = await saveExposure({ service_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: 'cms-7' });
    expect(result).toEqual({ success: true });
  });

  it.each(['/beta/', '/beta'])('stores %j as the one normalised location', async (path) => {
    expect(await saveExposure({ service_id: 1, hostname: 'a.example.com', path, tls: true, tailnet: null })).toEqual({
      success: true,
    });
    expect(mocks.createExposure).toHaveBeenCalledWith({
      data: expect.objectContaining({ hostname: 'a.example.com', path: '/beta' }),
    });
  });

  it('stores a blank hostname as null for a path-only exposure', async () => {
    const result = await saveExposure({ service_id: 1, hostname: '  ', path: '/beta', tls: true, tailnet: null });
    expect(result).toEqual({ success: true });
    expect(mocks.createExposure).toHaveBeenCalledWith({
      data: expect.objectContaining({ service_id: 1, hostname: null, path: '/beta' }),
    });
  });

  it('updates the named row in place when the input carries an id', async () => {
    const result = await saveExposure({ id: 9, service_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: null });
    expect(result).toEqual({ success: true });
    expect(mocks.updateExposure).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ service_id: 1 }),
    });
    expect(mocks.createExposure).not.toHaveBeenCalled();
  });

  it('refuses a create that collides with an existing location', async () => {
    mocks.createExposure.mockRejectedValue(UNIQUE_VIOLATION);
    const result = await saveExposure({ service_id: 1, hostname: 'a.example.com', path: '/', tls: true, tailnet: null });
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
