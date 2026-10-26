import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  waivers: vi.fn(),
  admins: vi.fn(),
  staleness: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    security_findings: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      count: mocks.count,
      groupBy: mocks.groupBy,
    },
    security_waivers: { findMany: mocks.waivers },
    admins: { findMany: mocks.admins },
  },
}));
vi.mock('@/lib/security/staleness', () => ({
  readStalenessSnapshotCached: mocks.staleness,
}));

import {
  mapPatchingFinding,
  readPatchingPage,
  readPatchingSnapshot,
} from '@/lib/security/patching-read';
import { PATCHING_PAGE_SIZE } from '@/lib/security/patching';

// The admin-name lookup is not what any of these tests is about: no account to resolve.
mocks.admins.mockResolvedValue([]);

const NOW = new Date('2026-10-25T12:00:00.000Z');
const TOTAL = 34_610;

/** The shape of one `security_findings` row as the database returns it. */
function findingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    source: 'rootfs',
    key: 'CVE-2026-1|openssl',
    kind: 'os-package',
    severity: 'CRITICAL',
    subject: 'openssl',
    installed: '1.0',
    available: '1.1',
    title: 'CVE-2026-1',
    url: null,
    host: 'box-a',
    detail: null,
    first_seen: new Date('2026-09-01T00:00:00.000Z'),
    last_seen: new Date('2026-10-24T00:00:00.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

function groupByRows(): Record<string, unknown>[] {
  return [
    { source: 'diun', severity: null, _count: { _all: 6 } },
    { source: 'rootfs', severity: 'CRITICAL', _count: { _all: 1_200 } },
    { source: 'rootfs', severity: 'HIGH', _count: { _all: 4_400 } },
    { source: 'rootfs', severity: 'MEDIUM', _count: { _all: 24_400 } },
    { source: 'osv', severity: 'MEDIUM', _count: { _all: 4_604 } },
    // A family outside the contract: the read must not count it into a card.
    { source: 'renovate', severity: 'HIGH', _count: { _all: 9_999 } },
  ];
}

function sourceGroupByRows(): Record<string, unknown>[] {
  return [
    { source: 'diun', _count: { _all: 6 } },
    { source: 'rootfs', _count: { _all: 30_000 } },
    { source: 'osv', _count: { _all: 4_604 } },
    { source: 'renovate', _count: { _all: 9_999 } },
  ];
}

function lastFindingQuery(): Record<string, any> {
  const calls = mocks.findMany.mock.calls.filter(([args]) => args !== undefined);
  return calls[calls.length - 1][0];
}

/**
 * The three counts this read makes, told apart by their `where`.
 *
 * WHY a `where`-aware mock: a fake that returns one number for every count would let the cards read
 * the aged total or the total read the fix-version count, and the test would still pass.
 */
function mockCounts(fixVersion: number): void {
  mocks.count.mockImplementation(async ({ where }: { where?: Record<string, any> }) => {
    if (where?.available !== undefined) return fixVersion;
    if (where?.OR !== undefined) return 1;
    return TOTAL;
  });
}

/** Every `count` call made with a given clause, so "the total came from a count" is checkable. */
function countCallsMatching(fragment: Record<string, unknown>): number {
  return mocks.count.mock.calls.filter(([args]) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    return Object.entries(fragment).every(([key, value]) => where[key] === value);
  }).length;
}

describe('the page read is bounded by SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([findingRow()]);
    mocks.findFirst.mockResolvedValue(null);
    mockCounts(1_200);
    mocks.groupBy.mockImplementation(async ({ by }: { by: readonly string[] }) =>
      by.includes('severity') ? groupByRows() : sourceGroupByRows(),
    );
    mocks.waivers.mockResolvedValue([]);
    mocks.staleness.mockResolvedValue({ readings: [], source: null });
  });

  it('takes exactly one page, from the index the clamp chose, with the filters as where clauses', async () => {
    const state = await readPatchingPage(
      { page: '3', source: 'rootfs', severity: 'HIGH', sort: 'subject', dir: 'asc' },
      NOW,
    );

    const query = lastFindingQuery();
    // A page is `take` rows after `skip` rows: everything else the query does is a filter, and no
    // step of it can return the feed.
    expect(query.take).toBe(PATCHING_PAGE_SIZE);
    expect(query.skip).toBe(2 * PATCHING_PAGE_SIZE);
    expect(query.where).toMatchObject({
      resolved_at: null,
      source: 'rootfs',
      severity: 'HIGH',
    });
    expect(query.orderBy).toEqual([{ subject: 'asc' }, { id: 'asc' }]);
    expect(state.page.query).toEqual({
      page: 3,
      source: 'rootfs',
      severity: 'HIGH',
      sort: 'subject',
      direction: 'asc',
    });
    expect(state.page.total).toBe(TOTAL);

    // The total came from a `count` carrying the same filters — never from the length of the page.
    expect(countCallsMatching({ source: 'rootfs', severity: 'HIGH' })).toBe(1);
    expect(mocks.findMany.mock.calls).toHaveLength(1);
  });

  it('never asks for rows when the filter matches none, so an empty page costs no scan', async () => {
    mocks.count.mockResolvedValue(0);

    const state = await readPatchingPage({}, NOW);

    expect(state.groups).toEqual([]);
    expect(state.page.query.page).toBe(1);
    expect(state.page.pageCount).toBe(1);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('sorts with a unique tie-break so a row cannot appear on two pages', async () => {
    await readPatchingPage({ sort: 'lastSeen' }, NOW);
    expect(lastFindingQuery().orderBy).toEqual([{ last_seen: 'desc' }, { id: 'asc' }]);
  });
});

describe('query validation and the clamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([findingRow()]);
    mocks.findFirst.mockResolvedValue(null);
    mockCounts(1_200);
    mocks.groupBy.mockImplementation(async ({ by }: { by: readonly string[] }) =>
      by.includes('severity') ? groupByRows() : sourceGroupByRows(),
    );
    mocks.waivers.mockResolvedValue([]);
    mocks.staleness.mockResolvedValue({ readings: [], source: null });
  });

  it('falls back to page 1 for anything that is not a positive integer', async () => {
    for (const page of ['abc', '0', '-1', '2.5', '']) {
      const state = await readPatchingPage({ page }, NOW);
      expect(state.page.query.page).toBe(1);
      expect(lastFindingQuery().skip).toBe(0);
    }
  });

  it('clamps a page past the end onto the last page instead of rendering an empty table', async () => {
    // 50 rows is two pages of 25: a reader landing on `?page=999` must end up where the rows are.
    mocks.count.mockResolvedValue(50);

    const state = await readPatchingPage({ page: '999' }, NOW);

    expect(state.page.total).toBe(50);
    expect(state.page.pageCount).toBe(2);
    expect(state.page.query.page).toBe(2);
    expect(lastFindingQuery().skip).toBe(PATCHING_PAGE_SIZE);
    expect(lastFindingQuery().take).toBe(PATCHING_PAGE_SIZE);
  });

  it('treats an unknown filter as no filter rather than as nothing at all', async () => {
    const state = await readPatchingPage({ source: 'renovate', severity: 'TERMINAL' }, NOW);

    expect(state.page.query.source).toBe('all');
    expect(state.page.query.severity).toBe('all');
    const where = lastFindingQuery().where;
    expect(where.source).toEqual({ in: ['diun', 'rootfs', 'osv'] });
    expect(where.severity).toBeUndefined();
  });

  it('falls back to the default sort for a key it cannot order by', async () => {
    await readPatchingPage({ sort: 'whatever', dir: 'sideways' }, NOW);

    const query = lastFindingQuery();
    expect(query.orderBy).toEqual([{ last_seen: 'desc' }, { id: 'asc' }]);
  });
});

describe('the cards come from an aggregate, not from rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The page has no rows to show, but the feed still holds them: only an aggregate knows that.
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);
    mockCounts(1_200);
    mocks.groupBy.mockImplementation(async ({ by }: { by: readonly string[] }) =>
      by.includes('severity') ? groupByRows() : sourceGroupByRows(),
    );
    mocks.waivers.mockResolvedValue([
      {
        id: 1,
        source: 'rootfs',
        match: 'CVE-2026-1',
        reason: 'backport pending',
        review_by: new Date('2026-10-01T00:00:00.000Z'),
        created_by: 1,
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        ended_at: null,
      },
    ]);
    mocks.staleness.mockResolvedValue({ readings: [], source: null });
  });

  it('counts the four numbers from groupBy, not from the rows the page fetched', async () => {
    const state = await readPatchingPage({}, NOW);

    // Not a single row came back, and the numbers are still the feed's: the cards cannot be a
    // count of the rows the table was handed.
    const rowsRead = await Promise.all(mocks.findMany.mock.results.map((result) => result.value));
    expect(rowsRead.flat()).toEqual([]);
    expect(state.cards).toEqual({
      staleImages: 6,
      // rootfs (30,000) + osv (4,604): the `renovate` row above is outside the contract.
      unresolvedCves: 34_604,
      expiredWaivers: 1,
      hostOsUpdates: 1_200,
    });
    // The table on the same read is empty — the two numbers cannot be reading each other.
    expect(state.groups).toEqual([]);
    expect(state.page.total).toBe(TOTAL);
  });

  it('gives the digest its totals without handing it the rows', async () => {
    const snapshot = await readPatchingSnapshot(NOW);

    // No finding ever travelled: the digest's numbers are the aggregate, its named rows are `take`d.
    expect(mocks.findMany.mock.calls.length).toBeGreaterThan(0);
    for (const [args] of mocks.findMany.mock.calls) {
      expect(typeof (args as { take?: unknown }).take).toBe('number');
    }
    expect(snapshot.signal.counts.openFindings).toBe(34_610);
    expect(snapshot.signal.counts.unwaivedCritical).toBe(1_200);
    expect(snapshot.signal.counts.unwaivedHigh).toBe(4_400);
    // The aged total is a `count` over the whole feed minus the rows a live waiver suppresses;
    // the one live waiver here covers a single row and findMany returned none, so no adjustment.
    expect(snapshot.signal.counts.agedFindings).toBe(TOTAL);
    expect(snapshot.signal.counts.expiredWaivers).toBe(1);
    expect(snapshot.signal.triggerCount).toBe(1_201);
    expect(snapshot.cards).toEqual({
      staleImages: 6,
      unresolvedCves: 34_604,
      expiredWaivers: 1,
      hostOsUpdates: 1_200,
    });
  });
});

describe('the scheduler signal path does not read the feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);
    mockCounts(1_200);
    mocks.groupBy.mockImplementation(async ({ by }: { by: readonly string[] }) =>
      by.includes('severity') ? groupByRows() : sourceGroupByRows(),
    );
    mocks.waivers.mockResolvedValue([]);
    mocks.staleness.mockResolvedValue({ readings: [], source: null });
  });

  it('asks for aggregates and for rows bounded by take, never for the unresolved set', async () => {
    const snapshot = await readPatchingSnapshot(NOW);

    const reads = mocks.findMany.mock.calls.map(([args]) => args as { take?: unknown });
    // The regression was a findMany over `resolved_at: null` with no take: it returned all 34,610
    // rows and the digest walked them. Every findings read now declares a bound.
    expect(reads.filter((args) => typeof args.take !== 'number')).toEqual([]);
    expect(reads.some((args) => (args.take as number) <= 12)).toBe(true);
    // The totals come from SQL counts, not from a row list.
    expect(mocks.groupBy).toHaveBeenCalled();
    expect(mocks.count).toHaveBeenCalled();
    expect(snapshot.signal.counts.openFindings).toBe(34_610);
  });

  it('is the read the scheduler itself calls', () => {
    const scheduler = readFileSync(
      join(__dirname, '..', 'src', 'scheduler', 'security-signal.ts'),
      'utf8',
    );
    expect(scheduler).toContain('readPatchingSnapshot');
    expect(scheduler).not.toContain('security_findings');
  });
});

describe('one row mapper', () => {
  it('is the only place a row becomes a PatchingFinding', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'lib', 'security', 'patching-read.ts'),
      'utf8',
    );
    // The paged read and the digest read must go through the same function: a second place that
    // formats `first_seen` is how the table and the card start describing one row differently.
    const mappings = source.split('firstSeen: row.first_seen.toISOString()').length - 1;
    expect(mappings).toBe(1);
    expect(source.match(/function mapPatchingFinding\(/g)).toHaveLength(1);
    expect(source.match(/function mapPatchingFindings\(/g)).toHaveLength(1);
  });

  it('refuses a source the contract cannot place instead of labelling it', () => {
    const mapped = mapPatchingFinding(
      findingRow({ source: 'renovate' }) as never,
      [],
      NOW,
    );
    expect(mapped).toBeNull();

    const known = mapPatchingFinding(findingRow() as never, [], NOW);
    expect(known).toMatchObject({
      source: 'rootfs',
      firstSeen: '2026-09-01T00:00:00.000Z',
      waiver: { status: 'none' },
    });
  });
});
