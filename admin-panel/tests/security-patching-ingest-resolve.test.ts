import { describe, expect, it } from 'vitest';

import { applyFeedPush, type FeedPush } from '@/lib/security/patching-ingest';

/**
 * The resolution rule, tested where it lives.
 *
 * WHY a separate file from the route test: the rule is "which rows may a complete push resolve",
 * and answering it needs rows whose `last_seen` straddles the run start. Driving that through the
 * route means fighting the real clock — the fake upsert stamps `last_seen = new Date()`, so every
 * fixture row looks "just seen" and the interesting case can never be constructed. `applyFeedPush`
 * takes `now`, so the timeline here is explicit.
 *
 * The rule exists because of a real failure: a 34,606-finding host scan was delivered in 139
 * batches, the last batch carried `complete: true`, and the route resolved everything the earlier
 * batches had just written — 34,500 findings closed while the log said all of them were accepted.
 */

interface Row {
  id: number;
  source: string;
  key: string;
  host: string | null;
  last_seen: Date;
  resolved_at: Date | null;
}

type WhereClause = {
  host?: string | null;
  resolved_at?: null | { lt: Date };
};

type UpdateWhere = {
  source: string;
  key?: string;
  host?: string;
  resolved_at?: null;
  last_seen?: { lt: Date };
  OR?: ReadonlyArray<WhereClause>;
};

function clauseMatches(row: Row, clause: WhereClause): boolean {
  if (clause.host !== undefined && row.host !== clause.host) return false;
  if (clause.resolved_at === null && row.resolved_at !== null) return false;
  if (clause.resolved_at !== undefined && clause.resolved_at !== null) {
    if (row.resolved_at === null || !(row.resolved_at < clause.resolved_at.lt)) return false;
  }
  return true;
}

function rowMatches(row: Row, where: UpdateWhere): boolean {
  if (row.source !== where.source) return false;
  if (where.key !== undefined && row.key !== where.key) return false;
  if (where.host !== undefined && row.host !== where.host) return false;
  if (where.resolved_at === null && row.resolved_at !== null) return false;
  if (where.last_seen !== undefined && !(row.last_seen < where.last_seen.lt)) return false;
  if (where.OR !== undefined && !where.OR.some((clause) => clauseMatches(row, clause))) return false;
  return true;
}

/**
 * An in-memory stand-in for the two writes the rule uses.
 *
 * WHY it reproduces the SQL predicates rather than recording the arguments: a recorder would
 * pass whether the predicate is `last_seen < runStart` or `last_seen < now`, and that difference
 * is the whole rule.
 */
function fakeClient(rows: Row[]) {
  let nextId = rows.length + 1;
  const client = {
    security_findings: {
      updateMany: async ({ where, data }: {
        where: UpdateWhere;
        data: { resolved_at: Date | null } & Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (!rowMatches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      createMany: async ({ data, skipDuplicates }: {
        data: ReadonlyArray<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const datum of data) {
          const found = rows.find(
            (row) => row.source === datum.source && row.key === datum.key,
          );
          if (found !== undefined) {
            if (skipDuplicates === true) continue;
            throw new Error(`unique constraint: ${String(datum.source)}/${String(datum.key)}`);
          }
          rows.push({
            id: nextId++,
            source: datum.source as string,
            key: datum.key as string,
            host: (datum.host as string | null) ?? null,
            last_seen: datum.last_seen as Date,
            resolved_at: (datum.resolved_at as Date | null) ?? null,
          });
          count += 1;
        }
        return { count };
      },
    },
  };
  return client;
}

function push(overrides: Partial<FeedPush> = {}): FeedPush {
  return {
    source: 'rootfs',
    host: 'box-a',
    findings: [
      {
        key: 'CVE-2026-1|openssl',
        kind: 'os',
        severity: 'HIGH',
        subject: 'openssl',
        installed: '3.0.2',
        available: '3.0.13',
        title: null,
        url: null,
        host: 'box-a',
        detail: null,
      } as FeedPush['findings'][number],
    ],
    complete: false,
    runStartedAt: new Date('2026-10-25T10:00:00.000Z'),
    ...overrides,
  };
}

describe('run-scoped resolution', () => {
  it('a partial push never resolves anything', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'stale', host: 'box-a', last_seen: new Date('2026-10-01T00:00:00Z'), resolved_at: null },
    ];
    const result = await applyFeedPush(fakeClient(rows) as never, push({ complete: false }), new Date('2026-10-25T10:00:05Z'));

    expect(result.resolved).toBe(0);
    expect(rows[0].resolved_at).toBeNull();
  });

  it('a complete push does not resolve rows an earlier batch of the same run wrote', async () => {
    // Exactly the production shape: batch 1 wrote 250 rows this run, batch 139 closes the run.
    const runStart = new Date('2026-10-25T10:00:00.000Z');
    const rows: Row[] = Array.from({ length: 250 }, (_unused, index) => ({
      id: index + 1,
      source: 'rootfs',
      key: `batch-1-${index}`,
      host: 'box-a',
      last_seen: new Date('2026-10-25T10:00:02.000Z'),
      resolved_at: null,
    }));

    const result = await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: true, runStartedAt: runStart, findings: [{ key: 'last-batch', kind: 'os', severity: 'LOW', subject: 'x', installed: null, available: null, title: null, url: null, host: 'box-a', detail: null } as FeedPush['findings'][number]] }),
      new Date('2026-10-25T10:00:38Z'),
    );

    expect(result.resolved).toBe(0);
    expect(rows.filter((row) => row.resolved_at !== null)).toHaveLength(0);
  });

  it('a complete push resolves rows last seen before the run started', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'gone', host: 'box-a', last_seen: new Date('2026-10-20T00:00:00Z'), resolved_at: null },
      { id: 2, source: 'rootfs', key: 'kept', host: 'box-a', last_seen: new Date('2026-10-25T10:00:03Z'), resolved_at: null },
    ];

    const result = await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: true, findings: [{ key: 'kept', kind: 'os', severity: 'LOW', subject: 'x', installed: null, available: null, title: null, url: null, host: 'box-a', detail: null } as FeedPush['findings'][number]] }),
      new Date('2026-10-25T10:00:38Z'),
    );

    expect(result.resolved).toBe(1);
    expect(rows.find((row) => row.key === 'gone')?.resolved_at).not.toBeNull();
    expect(rows.find((row) => row.key === 'kept')?.resolved_at).toBeNull();
  });

  it('resolution stays inside the host that pushed', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'other-host', host: 'box-b', last_seen: new Date('2026-10-01T00:00:00Z'), resolved_at: null },
      { id: 2, source: 'rootfs', key: 'this-host', host: 'box-a', last_seen: new Date('2026-10-01T00:00:00Z'), resolved_at: null },
    ];

    const result = await applyFeedPush(fakeClient(rows) as never, push({ complete: true }), new Date('2026-10-25T10:00:38Z'));

    expect(result.resolved).toBe(1);
    expect(rows.find((row) => row.key === 'other-host')?.resolved_at).toBeNull();
    expect(rows.find((row) => row.key === 'this-host')?.resolved_at).not.toBeNull();
  });

  it('a re-reported finding revives a row a previous run resolved', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'CVE-2026-1|openssl', host: 'box-a', last_seen: new Date('2026-09-01T00:00:00Z'), resolved_at: new Date('2026-10-01T00:00:00Z') },
    ];

    await applyFeedPush(fakeClient(rows) as never, push({ complete: true }), new Date('2026-10-25T10:00:38Z'));

    expect(rows[0].resolved_at).toBeNull();
    expect(rows[0].last_seen).toEqual(new Date('2026-10-25T10:00:38Z'));
  });

  it('a row touched by this run carries a last_seen at the run time, not the wall clock', async () => {
    const now = new Date('2026-10-25T10:00:38Z');
    const rows: Row[] = [];
    await applyFeedPush(fakeClient(rows) as never, push({ complete: true }), now);

    expect(rows).toHaveLength(1);
    expect(rows[0].last_seen).toEqual(now);
  });
});

/**
 * Two runs over one source, interleaved.
 *
 * WHY this is a separate group: every case above is a single run against rows it can only
 * resolve, so they all pass whether "newest evidence wins" is enforced or not. The producer
 * schedule makes two runs overlap for real — the nightly host scan takes ~3 minutes as 139
 * batches, so a manual re-scan started mid-scan is two runs writing one source at once — and
 * the rule has to say which run's evidence survives.
 *
 * The rule: a row's state is decided by the *newest run that touched it*. A late batch from an
 * older run may not reopen a resolution a newer run made, and an older run completing last may
 * not resolve rows a newer run has written.
 */
describe('two runs interleaved over one source', () => {
  const finding = (key: string, host = 'box-a'): FeedPush['findings'][number] =>
    ({
      key,
      kind: 'os',
      severity: 'HIGH',
      subject: key,
      installed: '1.0.0',
      available: '1.0.1',
      title: null,
      url: null,
      host,
      detail: null,
    }) as FeedPush['findings'][number];

  const at = (iso: string): Date => new Date(iso);

  it('the older run completing last does not resolve the newer run’s rows', async () => {
    const rows: Row[] = [];
    const client = fakeClient(rows);

    // The newer run starts at 10:10 and lands a batch two minutes in.
    const newer = await applyFeedPush(
      client as never,
      push({ complete: false, runStartedAt: at('2026-10-25T10:10:00Z'), findings: [finding('b-1')] }),
      at('2026-10-25T10:12:00Z'),
    );
    expect(newer.resolved).toBe(0);

    // The older run (started 10:00) finishes at 10:40 and claims the source is complete.
    const older = await applyFeedPush(
      client as never,
      push({ complete: true, runStartedAt: at('2026-10-25T10:00:00Z'), findings: [finding('a-1')] }),
      at('2026-10-25T10:40:00Z'),
    );

    expect(older.resolved).toBe(0);
    expect(rows.find((row) => row.key === 'b-1')?.resolved_at).toBeNull();
  });

  it('a late batch from the older run does not reopen what the newer run resolved', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'libssl', host: 'box-a', last_seen: at('2026-10-20T00:00:00Z'), resolved_at: null },
    ];
    const client = fakeClient(rows);

    // The newer run started at 10:10, found nothing, and closed the row at 10:20.
    const newer = await applyFeedPush(
      client as never,
      push({ complete: true, runStartedAt: at('2026-10-25T10:10:00Z'), findings: [] }),
      at('2026-10-25T10:20:00Z'),
    );
    expect(newer.resolved).toBe(1);
    expect(rows[0].resolved_at).toEqual(at('2026-10-25T10:20:00Z'));

    // The run that started at 10:00 was still scanning; its last batch arrives at 10:30 and
    // reports the row the newer, complete run has just declared gone.
    const older = await applyFeedPush(
      client as never,
      push({ complete: false, runStartedAt: at('2026-10-25T10:00:00Z'), findings: [finding('libssl')] }),
      at('2026-10-25T10:30:00Z'),
    );

    // The newer run's evidence wins: the row stays resolved and the older observation does not
    // freshen it, so the next scan's window is not widened by a phantom.
    expect(rows[0].resolved_at).toEqual(at('2026-10-25T10:20:00Z'));
    expect(rows[0].last_seen).toEqual(at('2026-10-20T00:00:00Z'));
    expect(older.held).toBe(1);
  });

  it('a run that started after the resolution still revives the row', async () => {
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'libssl', host: 'box-a', last_seen: at('2026-10-20T00:00:00Z'), resolved_at: at('2026-10-25T10:20:00Z') },
    ];

    const later = await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: false, runStartedAt: at('2026-10-25T11:00:00Z'), findings: [finding('libssl')] }),
      at('2026-10-25T11:02:00Z'),
    );

    expect(rows[0].resolved_at).toBeNull();
    expect(rows[0].last_seen).toEqual(at('2026-10-25T11:02:00Z'));
    expect(later.held).toBe(0);
  });

  it('a run that started in the same instant as the resolution is not newer than it', async () => {
    // WHY the boundary is pinned: `lt` versus `lte` here decides whether a tie reopens a row.
    // A tie is not newer evidence, and treating it as newer would let a batch that raced the
    // resolving push undo it.
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'libssl', host: 'box-a', last_seen: at('2026-10-20T00:00:00Z'), resolved_at: at('2026-10-25T10:20:00Z') },
    ];

    const tied = await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: false, runStartedAt: at('2026-10-25T10:20:00Z'), findings: [finding('libssl')] }),
      at('2026-10-25T10:30:00Z'),
    );

    expect(rows[0].resolved_at).toEqual(at('2026-10-25T10:20:00Z'));
    expect(tied.held).toBe(1);
  });
});

/**
 * Which host a row carries, and therefore which rows a complete push may close.
 *
 * WHY this is its own group: every case above writes and resolves rows whose `host` is already set,
 * which is the one shape production never had. The three jq mappers emit no per-finding `host`, so
 * every row was written with NULL while the resolve predicate compared the *envelope's* host
 * against that column — 52,441 open rows on the live host, a direct count that matched all of them,
 * and a complete push that resolved zero, every run, for as long as the feed has existed.
 */
describe('the host a row carries', () => {
  const bare = (key: string): FeedPush['findings'][number] =>
    ({
      key,
      kind: 'os',
      severity: 'HIGH',
      subject: key,
      installed: '1.0.0',
      available: '1.0.1',
      title: null,
      url: null,
      host: null, // what every mapper in docker/security-scan/lib/*.jq actually emits
      detail: null,
    }) as FeedPush['findings'][number];

  it('writes the push’s host on a finding that names none', async () => {
    const rows: Row[] = [];
    await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: false, host: 'box-a', findings: [bare('libssl')] }),
      new Date('2026-10-25T10:00:05Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe('box-a');
  });

  it('lets a finding name its own host when one push fans out several boxes', async () => {
    const rows: Row[] = [];
    await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: false, host: 'box-a', findings: [{ ...bare('libssl'), host: 'box-b' }] }),
      new Date('2026-10-25T10:00:05Z'),
    );

    expect(rows[0].host).toBe('box-b');
  });

  it('resolves the rows an earlier run wrote without a host', async () => {
    // The production shape: rows written before the envelope host reached the row carry NULL, and
    // the only claim a complete push can make about them is "not seen by this run".
    const rows: Row[] = [
      { id: 1, source: 'rootfs', key: 'gone', host: null, last_seen: new Date('2026-10-20T00:00:00Z'), resolved_at: null },
      { id: 2, source: 'rootfs', key: 'other-box', host: 'box-b', last_seen: new Date('2026-10-20T00:00:00Z'), resolved_at: null },
    ];

    const result = await applyFeedPush(
      fakeClient(rows) as never,
      push({ complete: true, host: 'box-a', findings: [bare('kept')] }),
      new Date('2026-10-25T10:00:38Z'),
    );

    expect(result.resolved).toBe(1);
    expect(rows.find((row) => row.key === 'gone')?.resolved_at).not.toBeNull();
    // Another box's rows stay open: the hostless clause is a legacy shape, not a licence to
    // resolve the whole source from one box's push.
    expect(rows.find((row) => row.key === 'other-box')?.resolved_at).toBeNull();
  });
});
