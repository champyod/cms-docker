import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The flip as the page reads it: one predicate for the filter, one for the count, and the banner
 * number. The SQL is asserted from the arguments the read path hands Prisma — which is the only
 * place the waiver predicate and the flip join can drift apart.
 */

const mocks = vi.hoisted(() => ({
  findings: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  waivers: vi.fn(),
  admins: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    security_findings: {
      findMany: mocks.findings,
      count: mocks.count,
      groupBy: mocks.groupBy,
    },
    security_waivers: { findMany: mocks.waivers },
    admins: { findMany: mocks.admins },
  },
}));

import { patchingSearchParams, readPatchingQuery } from '@/lib/security/patching';
import { readPatchingPage } from '@/lib/security/patching-read';
import { readWaivedReachable } from '@/lib/security/patching-read-flips';

const NOW = new Date('2026-11-12T10:00:00.000Z');
const TOTAL = 3;
const FLIPPED = 2;

interface WaiverRowSeed {
  readonly id: number;
  readonly source: string;
  readonly match: string;
  readonly reason: string;
  readonly review_by: Date;
  readonly created_at: Date;
  readonly created_by: number;
  readonly ended_at: Date | null;
}

function waiver(overrides: Partial<WaiverRowSeed> = {}): WaiverRowSeed {
  return {
    id: 7,
    source: 'rootfs',
    match: 'CVE-2026-7',
    reason: 'ksmbd was not loaded when this was judged',
    review_by: new Date('2026-12-01T00:00:00.000Z'),
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    created_by: 1,
    ended_at: null,
    ...overrides,
  };
}

function kernelRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    source: 'rootfs',
    key: 'CVE-2026-7|linux',
    kind: 'os-package',
    severity: 'CRITICAL',
    subject: 'linux',
    installed: '5.15.0-203',
    available: '5.15.0-204',
    title: 'kernel: ksmbd: ksmbd_write error',
    url: null,
    host: 'como-main',
    reachability: 'reachable',
    detail: null,
    first_seen: new Date('2026-10-01T00:00:00.000Z'),
    last_seen: new Date('2026-11-11T00:00:00.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

/** The `where` of one recorded query, as JSON, so a clause cannot be asserted by a loose match. */
function whereOf(call: readonly unknown[] | undefined): string {
  return JSON.stringify((call?.[0] as { where?: unknown } | undefined)?.where);
}

/** The flip clause itself: the AND member both the filter and the count are built from. */
function flipClause(where: string): string {
  return JSON.stringify((JSON.parse(where) as { AND?: unknown }).AND);
}

function lastFindingsWhere(): string {
  const calls = mocks.findings.mock.calls;
  return whereOf(calls[calls.length - 1]);
}

function countWheres(): string[] {
  return mocks.count.mock.calls.map(([args]) => JSON.stringify((args as { where: unknown }).where));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.waivers.mockResolvedValue([waiver()]);
  mocks.admins.mockResolvedValue([]);
  mocks.groupBy.mockImplementation(async ({ by }: { by: readonly string[] }) =>
    by.includes('severity')
      ? [{ source: 'rootfs', severity: 'CRITICAL', _count: { _all: TOTAL } }]
      : [{ source: 'rootfs', _count: { _all: TOTAL } }],
  );
  // Two counts are asked for on every page: the filtered total, and the flipped set.
  mocks.count.mockImplementation(async ({ where }: { where: unknown }) =>
    JSON.stringify(where).includes('cleared_at') ? FLIPPED : TOTAL,
  );
  mocks.findings.mockResolvedValue([kernelRow()]);
});

describe('the page filter selects the rows a waiver hides although they are reachable now', () => {
  it('filters on the waiver predicate, the stored verdict and an open flip — one clause', async () => {
    const state = await readPatchingPage({ flip: 'waived' }, NOW);

    expect(state.page.query.flip).toBe('waived');
    const where = lastFindingsWhere();
    expect(where).toContain('"reachability":"reachable"');
    expect(where).toContain('"cleared_at":null');
    // The waiver arrives through `waiverCoverWhere`, so the CVE it names is a key clause.
    expect(where).toContain('"key":"CVE-2026-7"');
    // Only a live decision can hide anything: the waiver read is pinned to `ended_at: null`.
    expect((mocks.waivers.mock.calls[0][0] as { where: unknown }).where).toEqual({ ended_at: null });
    // The total is the SQL count under the same flip clause, never the length of the page.
    const counted = countWheres().filter((clause) => clause.includes('cleared_at'));
    expect(flipClause(counted[counted.length - 1])).toBe(flipClause(where));
  });

  it('treats the absent filter as no clause rather than as a wildcard', async () => {
    await readPatchingPage({}, NOW);
    expect(lastFindingsWhere()).not.toContain('cleared_at');
  });

  it('selects nothing when no live waiver exists: nothing can be hidden by one', async () => {
    // `liveWaiverRows()` is the live decision set — an ended waiver is filtered out in SQL, so the
    // read path here sees exactly what it sees in production once a decision is over.
    mocks.waivers.mockResolvedValue([]);
    mocks.count.mockImplementation(async ({ where }: { where: unknown }) =>
      JSON.stringify(where).includes('"id":{"in":[]}') ? 0 : TOTAL,
    );

    const state = await readPatchingPage({ flip: 'waived' }, NOW);

    expect(state.page.total).toBe(0);
    expect(state.waivedReachable).toBe(0);
    // No page to fetch: the count already said the set is empty.
    expect(mocks.findings).not.toHaveBeenCalled();
    expect(countWheres().some((clause) => clause.includes('"id":{"in":[]}'))).toBe(true);
  });

  it('counts the flipped set for the banner, from the same clause the filter uses', async () => {
    const state = await readPatchingPage({}, NOW);

    expect(state.waivedReachable).toBe(FLIPPED);
    const clauses = mocks.count.mock.calls.map(([args]) => JSON.stringify(args));
    expect(clauses.some((clause) => clause.includes('"cleared_at":null') && clause.includes('"reachability":"reachable"'))).toBe(true);
  });

  it('round-trips the filter through the URL, and a stale value falls back to the unfiltered view', () => {
    const query = readPatchingQuery({ flip: 'waived' });
    expect(query.flip).toBe('waived');
    expect(patchingSearchParams(query)).toMatchObject({ flip: 'waived' });

    expect(readPatchingQuery({ flip: 'reachable' }).flip).toBe('all');
    expect(readPatchingQuery({}).flip).toBe('all');
  });
});

describe('the fact the signal pushes names the count and the worst row', () => {
  it('takes the worst severity, ties to the row hidden longest', async () => {
    mocks.count.mockResolvedValue(3);
    mocks.findings.mockResolvedValue([
      kernelRow({ id: 1, key: 'CVE-2026-7|linux', severity: 'HIGH', flip: { flipped_at: new Date('2026-11-01T00:00:00.000Z') } }),
      kernelRow({ id: 2, key: 'CVE-2026-8|linux', severity: 'CRITICAL', flip: { flipped_at: new Date('2026-11-05T00:00:00.000Z') } }),
      kernelRow({ id: 3, key: 'CVE-2026-9|linux', severity: 'CRITICAL', flip: { flipped_at: new Date('2026-11-02T00:00:00.000Z') } }),
    ]);

    const flips = await readWaivedReachable([waiver() as never]);

    expect(flips.count).toBe(3);
    expect(flips.worst).toMatchObject({
      key: 'CVE-2026-9|linux',
      severity: 'CRITICAL',
      host: 'como-main',
      flippedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  it('reads a severity outside the contract as unrated, never as the worst', async () => {
    mocks.count.mockResolvedValue(2);
    mocks.findings.mockResolvedValue([
      kernelRow({ id: 1, key: 'CVE-2026-7|linux', severity: 'SEVERE', flip: { flipped_at: new Date('2026-11-01T00:00:00.000Z') } }),
      kernelRow({ id: 2, key: 'CVE-2026-8|linux', severity: 'LOW', flip: { flipped_at: new Date('2026-11-05T00:00:00.000Z') } }),
    ]);

    const flips = await readWaivedReachable([waiver() as never]);

    expect(flips.worst?.severity).toBe('LOW');
  });
});
