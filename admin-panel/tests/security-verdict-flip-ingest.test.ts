import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { applyFeedPush } from '@/lib/security/patching-ingest';
import type { FeedPush } from '@/lib/security/patching-feed-push';

/**
 * The flip, as ingest sees it — end to end through `applyFeedPush`.
 *
 * WHY a store and not spies: the whole point is that detection compares this push's verdict with
 * the one already stored, so a test that mocks the answer would assert the mock. The fake below
 * keeps the two tables the rule touches, and the verdicts come from the real classifier driven by
 * the real module facts a scan sends.
 */

const NOW = new Date('2026-11-12T10:00:00.000Z');
const HOST = 'como-main';
const KSMBD = 'kernel: ksmbd: ksmbd_write error';

interface Row {
  id: number;
  source: string;
  key: string;
  severity: string | null;
  host: string | null;
  reachability: string;
  last_seen: Date;
  resolved_at: Date | null;
}

interface Waiver {
  id: number;
  source: string;
  match: string;
  ended_at: Date | null;
}

interface Flip {
  finding_id: number;
  host: string | null;
  severity: string | null;
  finding_key: string;
  from_verdict: string;
  waiver_id: number;
  flipped_at: Date;
  cleared_at: Date | null;
}

interface Seed {
  readonly rows?: readonly Row[];
  readonly waivers?: readonly Waiver[];
  readonly flips?: readonly Flip[];
}

interface StoredRead {
  readonly where: { readonly source: string; readonly key: { readonly in: readonly string[] } };
}

interface UpdateArgs {
  readonly where: {
    readonly source: string;
    readonly key?: string;
    readonly host?: string;
    readonly OR?: readonly { readonly resolved_at: null | { readonly lt: Date } }[];
    readonly last_seen?: { readonly lt: Date };
  };
  readonly data: { readonly reachability?: string; readonly last_seen?: Date; readonly resolved_at?: Date };
}

interface FlipUpsert {
  readonly where: { readonly finding_id: number };
  readonly create: Flip;
  readonly update: Partial<Flip>;
}

interface FlipUpdate {
  readonly where: { readonly finding_id?: number; readonly finding?: { readonly source: string } };
  readonly data: { readonly cleared_at: Date };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 1,
    source: 'rootfs',
    key: 'CVE-2026-9|linux',
    severity: 'CRITICAL',
    host: HOST,
    reachability: 'unreachable',
    last_seen: new Date('2026-11-11T00:00:00.000Z'),
    resolved_at: null,
    ...overrides,
  };
}

function fakeClient(seed: Seed = {}) {
  const rows = new Map<number, Row>((seed.rows ?? []).map((stored) => [stored.id, { ...stored }]));
  const waivers = seed.waivers ?? [];
  const flips = new Map<number, Flip>((seed.flips ?? []).map((flip) => [flip.finding_id, { ...flip }]));
  let nextId = Math.max(0, ...rows.keys()) + 1;

  const perFinding = async ({ where, data }: UpdateArgs) => {
    const stored = [...rows.values()].find((entry) => entry.source === where.source && entry.key === where.key);
    if (stored === undefined) return { count: 0 };
    // The causal guard the real statement carries: a row resolved by a newer run is not reopened.
    const reopenable = where.OR?.some((clause) =>
      clause.resolved_at === null ? stored.resolved_at === null : stored.resolved_at !== null && stored.resolved_at < clause.resolved_at.lt,
    );
    if (reopenable === false) return { count: 0 };
    Object.assign(stored, { reachability: data.reachability, resolved_at: null, last_seen: data.last_seen });
    return { count: 1 };
  };

  const bulkResolve = async ({ where, data }: UpdateArgs) => {
    let count = 0;
    for (const stored of rows.values()) {
      if (stored.source !== where.source || stored.resolved_at !== null) continue;
      if (where.host !== undefined && stored.host !== where.host) continue;
      if (where.last_seen !== undefined && !(stored.last_seen < where.last_seen.lt)) continue;
      stored.resolved_at = data.resolved_at ?? null;
      count += 1;
    }
    return { count };
  };

  const client = {
    security_host_modules: { findUnique: async (): Promise<null> => null, upsert: async () => ({}) },
    security_findings: {
      findMany: async ({ where }: StoredRead) =>
        [...rows.values()]
          .filter((stored) => stored.source === where.source && where.key.in.includes(stored.key))
          .map((stored) => ({ id: stored.id, key: stored.key, reachability: stored.reachability })),
      updateMany: async (args: UpdateArgs) =>
        typeof args.where.key === 'string' ? perFinding(args) : bulkResolve(args),
      createMany: async ({ data }: { data: ReadonlyArray<Record<string, unknown>> }) => {
        for (const datum of data) {
          rows.set(nextId, {
            id: nextId,
            source: String(datum.source),
            key: String(datum.key),
            severity: (datum.severity as string | null) ?? null,
            host: (datum.host as string | null) ?? null,
            reachability: String(datum.reachability),
            last_seen: datum.last_seen as Date,
            resolved_at: null,
          });
          nextId += 1;
        }
        return { count: data.length };
      },
    },
    security_waivers: {
      findMany: async ({ where }: { where: { source: string } }) =>
        waivers.filter((waiver) => waiver.source === where.source && waiver.ended_at === null),
    },
    security_finding_flips: {
      upsert: async ({ where, create, update }: FlipUpsert): Promise<Flip> => {
        const merged = { ...(flips.get(where.finding_id) ?? create), ...update };
        flips.set(where.finding_id, merged);
        return merged;
      },
      updateMany: async ({ where, data }: FlipUpdate) => {
        let count = 0;
        for (const flip of flips.values()) {
          if (flip.cleared_at !== null) continue;
          if (where.finding_id !== undefined && flip.finding_id !== where.finding_id) continue;
          if (where.finding !== undefined) {
            const stored = rows.get(flip.finding_id);
            if (stored === undefined || stored.resolved_at === null) continue;
          }
          flip.cleared_at = data.cleared_at;
          count += 1;
        }
        return { count };
      },
    },
  };
  return { client: client as unknown as Prisma.TransactionClient, rows, flips };
}

/** One finding, as the rootfs scan reports it; the verdict comes from the real classifier. */
function push(overrides: Partial<FeedPush> = {}): FeedPush {
  return {
    source: 'rootfs',
    host: HOST,
    findings: [
      {
        key: 'CVE-2026-9|linux',
        kind: 'os-package',
        severity: 'CRITICAL',
        subject: 'linux',
        installed: '5.15.0-203',
        available: '5.15.0-204',
        title: KSMBD,
        url: null,
        host: null,
        detail: null,
      },
    ],
    complete: false,
    runStartedAt: NOW,
    // The module was NOT loaded when the waiver was written; the next push says it is.
    hostModules: { kernelRelease: '5.15.0-203-generic', loaded: [], blocked: ['ksmbd'] },
    ...overrides,
  };
}

const LIVE_WAIVER: Waiver = { id: 7, source: 'rootfs', match: 'CVE-2026-9', ended_at: null };

describe('a verdict that flips under a live waiver is recorded at ingest', () => {
  it('records unreachable → reachable as a flip naming the waiver that hides it', async () => {
    const { client, flips } = fakeClient({ waivers: [LIVE_WAIVER] });

    await applyFeedPush(client, push(), NOW);
    // The same row, reported again with the module now loaded: the verdict changes under the waiver.
    await applyFeedPush(
      client,
      push({ hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['ksmbd'], blocked: [] } }),
      NOW,
    );

    expect([...flips.values()]).toEqual([
      expect.objectContaining({
        finding_id: 1,
        host: HOST,
        severity: 'CRITICAL',
        finding_key: 'CVE-2026-9|linux',
        from_verdict: 'unreachable',
        waiver_id: LIVE_WAIVER.id,
        cleared_at: null,
      }),
    ]);
  });

  it('records nothing when the row was already reachable: that waiver still fits its host', async () => {
    const { client, flips } = fakeClient({ rows: [row({ reachability: 'reachable' })], waivers: [LIVE_WAIVER] });

    await applyFeedPush(
      client,
      push({ hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['ksmbd'], blocked: [] } }),
      NOW,
    );

    expect(flips.size).toBe(0);
  });

  it('records nothing when no live waiver covers the row', async () => {
    const ended: Waiver = { id: 8, source: 'rootfs', match: 'CVE-2026-9', ended_at: new Date('2026-11-01T00:00:00.000Z') };
    const { client, flips } = fakeClient({ rows: [row()], waivers: [ended] });

    await applyFeedPush(
      client,
      push({ hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['ksmbd'], blocked: [] } }),
      NOW,
    );

    expect(flips.size).toBe(0);
  });

  it('records nothing for a report a newer run already resolved: a held write changed nothing', async () => {
    const stored = row({ resolved_at: new Date('2026-11-12T11:00:00.000Z') });
    const { client, flips } = fakeClient({ rows: [stored], waivers: [LIVE_WAIVER] });

    await applyFeedPush(
      client,
      push({ hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['ksmbd'], blocked: [] } }),
      NOW,
    );

    expect(flips.size).toBe(0);
  });

  it('closes the flip when the verdict leaves reachable', async () => {
    const flip: Flip = {
      finding_id: 1,
      host: HOST,
      severity: 'CRITICAL',
      finding_key: 'CVE-2026-9|linux',
      from_verdict: 'unknown',
      waiver_id: LIVE_WAIVER.id,
      flipped_at: new Date('2026-11-10T00:00:00.000Z'),
      cleared_at: null,
    };
    const { client, flips } = fakeClient({
      rows: [row({ reachability: 'reachable' })],
      waivers: [LIVE_WAIVER],
      flips: [flip],
    });

    await applyFeedPush(client, push(), NOW);

    expect(flips.get(1)?.cleared_at).toEqual(NOW);
  });

  it('closes the flip of a row a complete push resolves', async () => {
    const flip: Flip = {
      finding_id: 1,
      host: HOST,
      severity: 'CRITICAL',
      finding_key: 'CVE-2026-9|linux',
      from_verdict: 'unreachable',
      waiver_id: LIVE_WAIVER.id,
      flipped_at: new Date('2026-11-10T00:00:00.000Z'),
      cleared_at: null,
    };
    const { client, flips } = fakeClient({
      rows: [row({ reachability: 'reachable' })],
      waivers: [LIVE_WAIVER],
      flips: [flip],
    });

    const result = await applyFeedPush(client, push({ findings: [], complete: true }), NOW);

    expect(result.resolved).toBe(1);
    expect(flips.get(1)?.cleared_at).toEqual(NOW);
  });
});
