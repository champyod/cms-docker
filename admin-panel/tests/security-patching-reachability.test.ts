import type { Prisma } from '@prisma/client';
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

import { applyFeedPush } from '@/lib/security/patching-ingest';
import type { FeedPush } from '@/lib/security/patching-feed-push';
import { patchingSearchParams, readPatchingQuery } from '@/lib/security/patching';
import { readPatchingPage } from '@/lib/security/patching-read';

const NOW = new Date('2026-11-10T12:00:00.000Z');

/** One rootfs row as the database returns it; `reachability` is the stored verdict. */
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
    reachability: 'unknown',
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

function lastFindingQuery(): FindingQuery {
  const calls = mocks.findings.mock.calls;
  return calls[calls.length - 1][0] as FindingQuery;
}

function lastCountWhere(): Readonly<Record<string, unknown>> | undefined {
  const calls = mocks.count.mock.calls;
  return (calls[calls.length - 1][0] as FindingQuery).where;
}

function emptyGroupBy(by: readonly string[]): Record<string, unknown>[] {
  return by.includes('severity')
    ? [{ source: 'rootfs', severity: 'HIGH', _count: { _all: 4 } }]
    : [{ source: 'rootfs', _count: { _all: 4 } }];
}

/** A push from box-a, which blacklists ksmbd and does not run it. */
function pushWith(title: string): FeedPush {
  return {
    source: 'rootfs',
    host: 'box-a',
    findings: [
      {
        key: 'CVE-2026-9|linux',
        kind: 'os-package',
        severity: 'HIGH',
        subject: 'linux',
        installed: '6.12.9',
        available: '6.12.10',
        title,
        url: null,
        host: null,
        detail: null,
      },
    ],
    complete: false,
    runStartedAt: NOW,
    hostModules: { kernelRelease: '6.12.9-1-cachyos', loaded: ['cifs'], blocked: ['ksmbd'] },
  };
}

/** Runs one push through the ingest write and returns the row's stored verdict. */
async function ingestedVerdict(title: string): Promise<unknown> {
  const created: Record<string, unknown>[] = [];
  const client = {
    security_findings: {
      updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
    security_host_modules: { findUnique: async () => null, upsert: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  await applyFeedPush(client, pushWith(title), NOW);
  return created[0].reachability;
}

function rowReachabilities(state: Awaited<ReturnType<typeof readPatchingPage>>): string[] {
  return state.groups.flatMap((group) => group.findings.map((finding) => finding.reachability));
}

// Every read test starts from three rows, one per verdict; each test narrows what it needs.
beforeEach(() => {
  vi.clearAllMocks();
  mocks.waivers.mockResolvedValue([]);
  mocks.admins.mockResolvedValue([]);
  mocks.groupBy.mockImplementation(
    async ({ by }: { by: readonly string[] }): Promise<Record<string, unknown>[]> =>
      emptyGroupBy(by),
  );
  mocks.count.mockResolvedValue(3);
  mocks.findings.mockResolvedValue([
    kernelRow({ id: 1, reachability: 'reachable' }),
    kernelRow({ id: 2, reachability: 'unreachable' }),
    kernelRow({ id: 3, reachability: 'unknown' }),
  ]);
});
describe('the paged row renders the verdict stored at ingest', () => {
  it('renders each row its own stored column, with no verdict computed on the read path', async () => {
    const state = await readPatchingPage({}, NOW);

    expect(rowReachabilities(state)).toEqual(['reachable', 'unreachable', 'unknown']);
    // The rule runs once, at ingest: the read path must not even read the host module state.
    expect(mocks.hostModules).not.toHaveBeenCalled();
  });

  it('reads a stored value outside the three verdicts as unknown, never as safe', async () => {
    mocks.findings.mockResolvedValue([kernelRow({ id: 4, reachability: 'pending' })]);
    mocks.count.mockResolvedValue(1);

    const state = await readPatchingPage({}, NOW);
    expect(rowReachabilities(state)).toEqual(['unknown']);
  });
});

describe('the reachability filter selects on the stored column', () => {
  it('counts and pages under one predicate: the verdict, not a title prefix', async () => {
    const state = await readPatchingPage({ reachability: 'unreachable' }, NOW);

    expect(state.page.query.reachability).toBe('unreachable');
    const where = lastFindingQuery().where;
    expect(where).toMatchObject({ resolved_at: null, reachability: 'unreachable' });
    // No title clause survives: a capitalised `Kernel:` title cannot be filtered on by SQL.
    expect(JSON.stringify(where)).not.toContain('title');
    // The total is the SQL count under the same predicate, never the length of the page.
    expect(JSON.stringify(lastCountWhere())).toBe(JSON.stringify(where));
  });

  it('treats "all" as the absence of a clause rather than a wildcard', async () => {
    await readPatchingPage({}, NOW);
    expect(lastFindingQuery().where).not.toHaveProperty('reachability');
  });

  it('counts an unanswered row as unknown, with no OR over NULL titles or hosts', async () => {
    await readPatchingPage({ reachability: 'unknown' }, NOW);
    expect(lastFindingQuery().where).toMatchObject({ reachability: 'unknown' });
  });

  it('round-trips through the URL, and a stale value falls back to the unfiltered view', () => {
    const query = readPatchingQuery({ reachability: 'unreachable' });
    expect(query.reachability).toBe('unreachable');
    expect(patchingSearchParams(query)).toEqual({ reachability: 'unreachable' });

    expect(readPatchingQuery({ reachability: 'safe' }).reachability).toBe('all');
    expect(readPatchingQuery({}).reachability).toBe('all');
  });
});

describe('one rule, one implementation', () => {
  // The disagreement that made the SQL mirror a bug: the classifier parses `^kernel:` and the
  // dropped SQL matched case-insensitively, so one title had two answers. Both sides read the column now.
  it('answers a capitalised Kernel title from one value, for the badge and for the filter', async () => {
    const stored = await ingestedVerdict('Kernel: ksmbd: use-after-free');
    // The classifier cannot see a subsystem in that title, so it stores the honest answer.
    expect(stored).toBe('unknown');
    // The lower-case spelling is a different question and gets the host's real answer.
    expect(await ingestedVerdict('kernel: ksmbd: use-after-free')).toBe('unreachable');

    mocks.findings.mockResolvedValue([
      kernelRow({ id: 1, title: 'Kernel: ksmbd: use-after-free', reachability: stored }),
    ]);
    const state = await readPatchingPage({ reachability: 'unknown' }, NOW);

    expect(rowReachabilities(state)).toEqual([stored]);
    expect(lastFindingQuery().where).toMatchObject({ reachability: stored });
  });

  it('refreshes the stored verdict when a producer re-reports the row', async () => {
    const updates: Record<string, unknown>[] = [];
    const client = {
      security_findings: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        },
        createMany: async () => ({ count: 0 }),
      },
      security_host_modules: { findUnique: async () => null, upsert: async () => ({}) },
    } as unknown as Prisma.TransactionClient;

    await applyFeedPush(client, pushWith('kernel: ksmbd: use-after-free'), NOW);
    expect(updates[0]).toMatchObject({ reachability: 'unreachable' });
    expect(updates[0]).toHaveProperty('last_seen', NOW);
  });
});
