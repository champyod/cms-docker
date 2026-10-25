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

function fakeClient(rows: Row[]) {
  let nextId = rows.length + 1;
  const client = {
    security_findings: {
      upsert: async ({ where, create, update }: {
        where: { source_key: { source: string; key: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const found = rows.find(
          (row) => row.source === where.source_key.source && row.key === where.source_key.key,
        );
        if (found !== undefined) {
          Object.assign(found, update);
          return found;
        }
        const created: Row = {
          id: nextId++,
          source: where.source_key.source,
          key: where.source_key.key,
          host: (create.host as string | null) ?? null,
          last_seen: create.last_seen as Date,
          resolved_at: null,
        };
        rows.push(created);
        return created;
      },
      updateMany: async ({ where, data }: {
        where: { source: string; host?: string; resolved_at: null; last_seen?: { lt: Date } };
        data: { resolved_at: Date };
      }) => {
        let count = 0;
        for (const row of rows) {
          if (row.source !== where.source || row.resolved_at !== null) continue;
          if (where.host !== undefined && row.host !== where.host) continue;
          if (where.last_seen !== undefined && !(row.last_seen < where.last_seen.lt)) continue;
          row.resolved_at = data.resolved_at;
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
