import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findings: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  waivers: vi.fn(),
  admins: vi.fn(),
  hostModules: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    security_findings: {
      findMany: mocks.findings,
      count: mocks.count,
      groupBy: mocks.groupBy,
    },
    security_waivers: { findMany: mocks.waivers },
    security_host_modules: { findMany: mocks.hostModules },
    admins: { findMany: mocks.admins },
  },
}));

import { readPatchingPage } from '@/lib/security/patching-read';
import { patchingSearchParams, readPatchingQuery } from '@/lib/security/patching';

const NOW = new Date('2026-11-10T12:00:00.000Z');

// The production pair: ksmbd is blacklisted on box-a and box-b, and loaded on box-a only.
const HOST_STATE = {
  host: 'box-a',
  kernel_release: '6.12.9-1-cachyos',
  loaded: ['ksmbd', 'cifs'],
  blocked: ['ksmbd'],
};

const UNLOADED_STATE = {
  host: 'box-b',
  kernel_release: '6.12.9-1-cachyos',
  loaded: [],
  blocked: ['ksmbd'],
};

/** One rootfs row as the database returns it; the title carries the subsystem being classified. */
function kernelRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    source: 'rootfs',
    key: 'CVE-2026-9|linux',
    kind: 'os-package',
    severity: 'HIGH',
    subject: 'linux',
    installed: '6.12.9',
    available: '6.12.10',
    title: 'kernel: ksmbd: ksmbd_write error',
    url: null,
    host: 'box-a',
    detail: null,
    first_seen: new Date('2026-10-01T00:00:00.000Z'),
    last_seen: new Date('2026-11-09T00:00:00.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

interface FindingQuery {
  readonly where?: Readonly<Record<string, unknown>>;
  readonly take?: number;
}

function pageRowIds(state: Awaited<ReturnType<typeof readPatchingPage>>): number[] {
  return state.groups.flatMap((group) => group.findings.map((finding) => finding.id));
}

function lastFindingQuery(): FindingQuery {
  const calls = mocks.findings.mock.calls;
  return calls[calls.length - 1][0] as FindingQuery;
}

function emptyGroupBy(by: readonly string[]): Record<string, unknown>[] {
  return by.includes('severity')
    ? [{ source: 'rootfs', severity: 'HIGH', _count: { _all: 4 } }]
    : [{ source: 'rootfs', _count: { _all: 4 } }];
}

describe('reachability on the paged row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waivers.mockResolvedValue([]);
    mocks.admins.mockResolvedValue([]);
    mocks.hostModules.mockResolvedValue([HOST_STATE, UNLOADED_STATE]);
    mocks.groupBy.mockImplementation(
      async ({ by }: { by: readonly string[] }): Promise<Record<string, unknown>[]> =>
        emptyGroupBy(by),
    );
    mocks.count.mockResolvedValue(3);
    mocks.findings.mockResolvedValue([
      kernelRow({ id: 1, host: 'box-a' }),
      kernelRow({ id: 2, host: 'box-b' }),
      kernelRow({ id: 3, host: 'box-c' }),
    ]);
  });

  it('classifies each row from its own title and its own host, not from the page', async () => {
    const state = await readPatchingPage({}, NOW);
    const verdicts = state.groups
      .flatMap((group) => group.findings)
      .map((finding) => [finding.id, finding.reachability]);

    // box-a runs ksmbd (blacklisted and loaded: loaded wins), box-b only blacklists it, box-c never
    // reported a module state — the three verdicts the classifier can produce.
    expect(verdicts).toEqual([
      [1, 'reachable'],
      [2, 'unreachable'],
      [3, 'unknown'],
    ]);
    expect(pageRowIds(state)).toEqual([1, 2, 3]);
  });

  it('reads the host module state once for the whole page, never once per row', async () => {
    await readPatchingPage({}, NOW);
    expect(mocks.hostModules).toHaveBeenCalledTimes(1);
    expect(mocks.hostModules).toHaveBeenCalledWith({
      select: { host: true, loaded: true, blocked: true },
    });
  });

  it('reports a row with no kernel subsystem as unknown rather than inventing a verdict', async () => {
    mocks.findings.mockResolvedValue([kernelRow({ id: 4, title: 'CVE-2026-9', host: 'box-a' })]);
    mocks.count.mockResolvedValue(1);

    const state = await readPatchingPage({}, NOW);
    expect(state.groups[0].findings[0].reachability).toBe('unknown');
  });
});

describe('the reachability filter is a real query parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waivers.mockResolvedValue([]);
    mocks.admins.mockResolvedValue([]);
    mocks.hostModules.mockResolvedValue([HOST_STATE, UNLOADED_STATE]);
    mocks.groupBy.mockImplementation(
      async ({ by }: { by: readonly string[] }): Promise<Record<string, unknown>[]> =>
        emptyGroupBy(by),
    );
    mocks.count.mockResolvedValue(1);
    mocks.findings.mockResolvedValue([kernelRow({ id: 2, host: 'box-b' })]);
  });

  it('filters the count and the page by the host whose module state says it is unloaded', async () => {
    const state = await readPatchingPage({ reachability: 'unreachable' }, NOW);

    expect(state.page.query.reachability).toBe('unreachable');
    const where = lastFindingQuery().where;
    expect(where).toMatchObject({ resolved_at: null });

    // The predicate names the one host that reported ksmbd unloaded, and its kernel title prefix.
    const or = where?.OR as readonly Readonly<Record<string, unknown>>[];
    const unloaded = or.find((clause) => clause.host === 'box-b');
    expect(JSON.stringify(unloaded)).toContain('kernel: ksmbd:');
    // box-a loaded ksmbd, so that subsystem is not unreachable there — other subsystems still are.
    const loadedHost = or.find((clause) => clause.host === 'box-a');
    expect(JSON.stringify(loadedHost)).not.toContain('kernel: ksmbd:');

    // The total is the SQL count under the same predicate, never the length of the page.
    const countCalls = mocks.count.mock.calls;
    const counted = countCalls[countCalls.length - 1][0] as FindingQuery;
    expect(JSON.stringify(counted.where)).toBe(JSON.stringify(where));
  });

  it('keeps a reachable subsystem on a loaded host and the built-in code paths', async () => {
    await readPatchingPage({ reachability: 'reachable' }, NOW);
    const serialized = JSON.stringify(lastFindingQuery().where);

    expect(serialized).toContain('box-a');
    expect(serialized).toContain('kernel: ksmbd:');
    // `bpf` is compiled into every kernel, so it is reachable with no host report at all.
    expect(serialized).toContain('kernel: bpf:');
    expect(serialized).not.toContain('box-b');
  });

  it('never counts a NULL title or host as reachable or unreachable: those rows are unknown', async () => {
    await readPatchingPage({ reachability: 'unknown' }, NOW);
    const where = lastFindingQuery().where as Readonly<Record<string, unknown>>;
    const or = where.OR as readonly Readonly<Record<string, unknown>>[];

    expect(or).toContainEqual({ title: null });
    expect(or).toContainEqual({ host: null });
    expect(JSON.stringify(or)).toContain('"NOT"');
  });

  it('round-trips through the URL, and a stale value falls back to the unfiltered view', () => {
    const query = readPatchingQuery({ reachability: 'unreachable' });
    expect(query.reachability).toBe('unreachable');
    expect(patchingSearchParams(query)).toEqual({ reachability: 'unreachable' });

    expect(readPatchingQuery({ reachability: 'safe' }).reachability).toBe('all');
    expect(readPatchingQuery({}).reachability).toBe('all');
  });
});
