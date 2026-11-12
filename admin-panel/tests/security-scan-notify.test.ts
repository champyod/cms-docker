import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Why a fake store: the contract here is "one message per run, deduped by the run's start, and a
 * failure that neither throws nor forgets". The module reads its numbers through the real read path
 * (`readCompletedScanFacts`), so the store has to answer what that asks — aggregates, the bound
 * CRITICAL rows, and the waiver table — which makes the assertions about what a human was told.
 */
interface FakeFinding {
  id: number;
  source: string;
  key: string;
  kind: string;
  severity: string | null;
  subject: string;
  installed: string | null;
  available: string | null;
  title: string | null;
  url: string | null;
  host: string | null;
  reachability: string;
  first_seen: Date;
  last_seen: Date;
  resolved_at: Date | null;
}

interface FakeWaiver {
  id: number;
  source: string;
  match: string;
  review_by: Date;
  ended_at: Date | null;
}

interface FakeAuditRow {
  verb: string;
  entity: string;
  entity_id: string | null;
  result: string;
  reason: string | null;
  afterValues: unknown;
}

type Where = Record<string, unknown>;
type Row = Record<string, unknown>;
type Seed = Omit<FakeFinding, 'id' | 'kind' | 'installed' | 'available' | 'url' | 'reachability' | 'last_seen' | 'resolved_at' | 'title'> &
  Partial<Pick<FakeFinding, 'title' | 'resolved_at'>>;

const mocks = vi.hoisted(() => {
  const findings = new Map<number, Row>();
  const waivers: Row[] = [];
  const auditRows: FakeAuditRow[] = [];
  const messages: { title: string; body: string; color: number; mention: boolean }[] = [];
  let deliver: () => Promise<boolean> = async () => true;
  let nextId = 1;

  const matchesField = (value: unknown, cond: unknown): boolean => {
    if (cond === null) return value === null;
    if (typeof cond === 'string') return value === cond;
    if (typeof cond === 'object' && cond !== null) {
      const clause = cond as { contains?: string; gte?: Date; in?: string[] };
      if (clause.contains !== undefined) return typeof value === 'string' && value.includes(clause.contains);
      if (clause.gte !== undefined) return value instanceof Date && value.getTime() >= clause.gte.getTime();
      if (clause.in !== undefined) return typeof value === 'string' && clause.in.includes(value);
    }
    return false;
  };

  const matches = (row: Row, where: Where): boolean =>
    Object.entries(where).every(([field, cond]) => {
      if (field === 'AND') return (cond as Where[]).every((clause) => matches(row, clause));
      if (field === 'OR') return (cond as Where[]).some((clause) => matches(row, clause));
      return matchesField(row[field], cond);
    });

  const ordered = (rows: Row[]): Row[] =>
    rows.sort(
      (left, right) =>
        (left.first_seen as Date).getTime() - (right.first_seen as Date).getTime()
        || (left.id as number) - (right.id as number),
    );

  const security_findings = {
    groupBy: async (args: { by: string[]; where: Where }): Promise<Row[]> => {
      const groups = new Map<string, Row>();
      for (const row of findings.values()) {
        if (!matches(row, args.where)) continue;
        const label = args.by.map((field) => String(row[field])).join('\u0000');
        const group = groups.get(label) ?? {
          ...Object.fromEntries(args.by.map((field) => [field, row[field]])),
          _count: { _all: 0 },
        };
        (group._count as { _all: number })._all += 1;
        groups.set(label, group);
      }
      return [...groups.values()];
    },
    count: async (args: { where: Where }): Promise<number> =>
      [...findings.values()].filter((row) => matches(row, args.where)).length,
    findMany: async (args: { where: Where; take?: number }): Promise<Row[]> => {
      const rows = ordered([...findings.values()].filter((row) => matches(row, args.where)));
      return args.take === undefined ? rows : rows.slice(0, args.take);
    },
  };

  const security_waivers = {
    findMany: async (args: { where: Where }): Promise<Row[]> =>
      waivers.filter((waiver) => matches(waiver, args.where)),
  };

  // The ledger the module dedupes against: `recordAudit` is mocked, so the fake has to hold the rows
  // that mock writes — otherwise the dedupe test would pass against a store nothing ever fills.
  const audit_log = {
    findFirst: async (args: { where: { entity: string; verb: string; entity_id: string } }): Promise<{ id: number } | null> => {
      const found = auditRows.some(
        (row) =>
          row.entity === args.where.entity &&
          row.verb === args.where.verb &&
          row.entity_id === args.where.entity_id,
      );
      return found ? { id: 1 } : null;
    },
  };

  return {
    messages,
    auditRows,
    fakePrisma: { security_findings, security_waivers, audit_log },
    recordAudit: vi.fn(async (entry: { verb: string; entity: string; entityId?: string; result: string; reason?: string; afterValues?: unknown }): Promise<void> => {
      auditRows.push({
        verb: entry.verb,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        result: entry.result,
        reason: entry.reason ?? null,
        afterValues: entry.afterValues,
      });
    }),
    logToDiscord: vi.fn(async (title: string, body: string, color: number, mention: boolean): Promise<boolean> => {
      messages.push({ title, body, color, mention });
      return await deliver();
    }),
    setDelivery: (next: () => Promise<boolean>): void => {
      deliver = next;
    },
    seedFinding: (seed: Seed): void => {
      findings.set(nextId, {
        kind: 'os-package',
        installed: '1.0.0',
        available: '1.0.1',
        url: null,
        reachability: 'unknown',
        title: null,
        resolved_at: null,
        ...seed,
        id: nextId,
        last_seen: seed.first_seen,
      });
      nextId += 1;
    },
    seedWaiver: (waiver: FakeWaiver): void => {
      waivers.push({ ...waiver });
    },
    reset: (): void => {
      findings.clear();
      waivers.length = 0;
      auditRows.length = 0;
      messages.length = 0;
      nextId = 1;
      deliver = async () => true;
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.fakePrisma }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/discord-notifier', () => ({ logToDiscord: mocks.logToDiscord }));

const { announceCompletedScan, SCAN_NOTIFIED_VERB, SCAN_NOTIFY_FAILED_VERB } = await import(
  '@/lib/security/scan-notify'
);

const RUN_AT = new Date('2026-11-12T03:00:00.000Z');
const NOW = new Date('2026-11-12T03:05:00.000Z');
const RUN = { source: 'rootfs', host: 'box-a', runStartedAt: RUN_AT };

function seedScan(): void {
  // One CRITICAL under a live waiver, one unwaived HIGH, one unwaived MEDIUM — and one row an earlier
  // run left unresolved, so "new this run" has something to leave out.
  mocks.seedWaiver({
    id: 7,
    source: 'rootfs',
    match: 'CVE-2026-2201',
    review_by: new Date('2026-12-01T00:00:00.000Z'),
    ended_at: null,
  });
  mocks.seedFinding({
    source: 'rootfs', key: 'CVE-2026-2201|libxml2', severity: 'CRITICAL', subject: 'libxml2',
    host: 'box-a', first_seen: new Date('2026-11-12T03:01:00.000Z'),
  });
  mocks.seedFinding({
    source: 'rootfs', key: 'CVE-2026-1187|openssl', severity: 'HIGH', subject: 'openssl',
    host: 'box-a', first_seen: new Date('2026-11-12T03:01:30.000Z'),
  });
  mocks.seedFinding({
    source: 'rootfs', key: 'CVE-2025-0001|zlib', severity: 'MEDIUM', subject: 'zlib',
    host: 'box-a', first_seen: new Date('2026-11-01T00:00:00.000Z'),
  });
}

describe('announceCompletedScan', () => {
  beforeEach(() => {
    mocks.reset();
    mocks.recordAudit.mockClear();
    mocks.logToDiscord.mockClear();
    seedScan();
  });

  it('sends one message for a completed run, naming the CRITICAL and counting the rest', async () => {
    const status = await announceCompletedScan(RUN, 1, NOW);

    expect(status).toBe('sent');
    expect(mocks.messages).toHaveLength(1);
    const [message] = mocks.messages;
    expect(message.title).toBe('Security scan complete: box-a');
    expect(message.body).toContain('box-a · 2026-11-12 03:00 UTC · 3 findings, 2 new this run');
    expect(message.body).toContain('libxml2 (CVE-2026-2201) — waived until 2026-12-01');
    expect(message.body).toContain('HIGH 1 · MEDIUM 1 · LOW 0 · 1 waived');
    // A waived CRITICAL is context, not an alarm: no role ping.
    expect(message.mention).toBe(false);
    expect(mocks.auditRows).toEqual([
      expect.objectContaining({
        verb: SCAN_NOTIFIED_VERB,
        entity: 'security.scan',
        entity_id: 'rootfs|box-a|2026-11-12T03:00:00.000Z',
        result: 'success',
      }),
    ]);
  });

  it('pings the role when a named CRITICAL has no live decision behind it', async () => {
    mocks.seedFinding({
      source: 'rootfs', key: 'CVE-2026-9000|glibc', severity: 'CRITICAL', subject: 'glibc',
      host: 'box-a', first_seen: new Date('2026-11-12T03:02:00.000Z'),
    });

    await announceCompletedScan(RUN, 1, NOW);

    expect(mocks.messages[0].mention).toBe(true);
    expect(mocks.messages[0].body).toContain('glibc (CVE-2026-9000) — no waiver');
  });

  it('sends nothing on a re-push of the same run', async () => {
    const first = await announceCompletedScan(RUN, 1, NOW);
    const second = await announceCompletedScan(RUN, 1, NOW);

    expect([first, second]).toEqual(['sent', 'already-sent']);
    expect(mocks.messages).toHaveLength(1);
    expect(mocks.auditRows.filter((row) => row.verb === SCAN_NOTIFIED_VERB)).toHaveLength(1);
  });

  it('speaks again for a different run, even when nothing in the feed changed', async () => {
    await announceCompletedScan(RUN, 1, NOW);
    const next = await announceCompletedScan({ ...RUN, runStartedAt: new Date('2026-11-12T04:00:00.000Z') }, 1, NOW);

    expect(next).toBe('sent');
    expect(mocks.messages).toHaveLength(2);
    expect(mocks.messages[1].body).toContain('04:00 UTC');
  });

  it('records a swallowed message where an operator can see it, and keeps the run retryable', async () => {
    mocks.setDelivery(async () => false);

    const failed = await announceCompletedScan(RUN, 1, NOW);

    expect(failed).toBe('failed');
    expect(mocks.auditRows).toEqual([
      expect.objectContaining({
        verb: SCAN_NOTIFY_FAILED_VERB,
        entity_id: 'rootfs|box-a|2026-11-12T03:00:00.000Z',
        result: 'failure',
      }),
    ]);
    // The failure row does not consume the run's slot: once Discord answers, that run is announced.
    mocks.setDelivery(async () => true);
    expect(await announceCompletedScan(RUN, 1, NOW)).toBe('sent');
    expect(mocks.messages).toHaveLength(2);
  });

  it('never throws when the notifier itself fails', async () => {
    mocks.setDelivery(async () => {
      throw new Error('getaddrinfo ENOTFOUND discord.com');
    });

    await expect(announceCompletedScan(RUN, 1, NOW)).resolves.toBe('failed');
    expect(mocks.auditRows).toEqual([
      expect.objectContaining({ verb: SCAN_NOTIFY_FAILED_VERB, reason: 'getaddrinfo ENOTFOUND discord.com' }),
    ]);
  });

  it('keeps another host’s rows out of the message it did not push', async () => {
    mocks.seedFinding({
      source: 'rootfs', key: 'CVE-2026-7000|bash', severity: 'CRITICAL', subject: 'bash',
      host: 'box-b', first_seen: new Date('2026-11-12T03:02:00.000Z'),
    });

    await announceCompletedScan(RUN, 1, NOW);

    expect(mocks.messages[0].body).toContain('3 findings, 2 new this run');
    expect(mocks.messages[0].body).not.toContain('bash');
  });
});
