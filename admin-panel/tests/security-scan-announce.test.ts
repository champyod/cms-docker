import { beforeEach, describe, expect, it, vi } from 'vitest';

// Why a store and not call assertions: the contract is about what a human was told. The facts are
// counted through the real read path, so the store has to answer what that path asks — aggregates,
// bounded row lists, the waiver table and the ingest ledger.

type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const findings: Row[] = [];
  const waivers: Row[] = [];
  const pushes: { id: number; timestamp: Date; entity: string; verb: string; after_values: unknown }[] = [];
  const audits: {
    verb: string; entity: string; entity_id: string | null; result: string;
    reason: string | null; afterValues: unknown;
  }[] = [];
  const messages: { title: string; body: string; color: number; mention: boolean; footer?: string }[] = [];
  let nextFindingId = 1;
  let nextPushId = 1;
  let deliver: () => Promise<boolean> = async () => true;
  let webhook = true;

  interface Query {
    where?: Row;
    orderBy?: Row | Row[];
    take?: number;
    skip?: number;
    by?: string[];
  }

  const isDate = (value: unknown): value is Date => value instanceof Date;

  /** The operators the read path actually uses: equality, null, contains, ranges, in/notIn, not. */
  function matchField(value: unknown, cond: unknown): boolean {
    if (cond === null) return value === null;
    if (isDate(cond)) return isDate(value) && value.getTime() === cond.getTime();
    if (typeof cond !== 'object') return value === cond;
    const clause = cond as {
      contains?: string; gte?: Date; lte?: Date; lt?: Date;
      in?: unknown[]; notIn?: unknown[]; not?: unknown; equals?: unknown;
    };
    if (clause.contains !== undefined) return typeof value === 'string' && value.includes(clause.contains);
    if (clause.gte !== undefined) return isDate(value) && value.getTime() >= clause.gte.getTime();
    if (clause.lte !== undefined) return isDate(value) && value.getTime() <= clause.lte.getTime();
    if (clause.lt !== undefined) return isDate(value) && value.getTime() < clause.lt.getTime();
    if (clause.in !== undefined) return clause.in.includes(value);
    if (clause.notIn !== undefined) return !clause.notIn.includes(value);
    if ('not' in clause) return !matchField(value, clause.not);
    if ('equals' in clause) return value === clause.equals;
    return false;
  }

  function matches(row: Row, where: Row = {}): boolean {
    for (const [field, cond] of Object.entries(where)) {
      if (field === 'AND') {
        if (!(cond as Row[]).every((clause) => matches(row, clause))) return false;
      } else if (field === 'OR') {
        if (!(cond as Row[]).some((clause) => matches(row, clause))) return false;
      } else if (field === 'NOT') {
        if (matches(row, cond as Row)) return false;
      } else if (!matchField(row[field], cond)) return false;
    }
    return true;
  }

  function ordered(rows: Row[], orderBy?: Row | Row[]): Row[] {
    const spec = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((left, right) => {
      for (const clause of spec) {
        const [field, direction] = Object.entries(clause)[0] as [string, 'asc' | 'desc'];
        const a = left[field];
        const b = right[field];
        const delta = isDate(a) && isDate(b)
          ? a.getTime() - b.getTime()
          : a === b
            ? 0
            : (a as number | string) < (b as number | string) ? -1 : 1;
        if (delta !== 0) return direction === 'desc' ? -delta : delta;
      }
      return 0;
    });
  }

  const security_findings = {
    findMany: async ({ where = {}, orderBy, take, skip }: Query): Promise<Row[]> => {
      const rows = ordered(findings.filter((row) => matches(row, where)), orderBy);
      const from = skip ?? 0;
      return take === undefined ? rows.slice(from) : rows.slice(from, from + take);
    },
    findFirst: async ({ where = {}, orderBy }: Query): Promise<Row | null> =>
      ordered(findings.filter((row) => matches(row, where)), orderBy)[0] ?? null,
    count: async ({ where = {} }: Query): Promise<number> => findings.filter((row) => matches(row, where)).length,
    groupBy: async ({ by = [], where = {} }: Query): Promise<Row[]> => {
      const groups = new Map<string, Row>();
      for (const row of findings.filter((entry) => matches(entry, where))) {
        const label = by.map((field) => String(row[field])).join('\u0000');
        const group = groups.get(label) ?? {
          ...Object.fromEntries(by.map((field) => [field, row[field]])),
          _count: { _all: 0 },
        };
        (group._count as { _all: number })._all += 1;
        groups.set(label, group);
      }
      return [...groups.values()];
    },
  };

  const security_waivers = {
    findMany: async ({ where = {}, orderBy }: Query): Promise<Row[]> =>
      ordered(waivers.filter((row) => matches(row, where)), orderBy),
  };

  const audit_log = {
    findMany: async ({ where = {}, take }: Query): Promise<Row[]> => {
      const rows = pushes.filter((row) => matches(row as unknown as Row, where));
      const newestFirst = [...rows].sort((left, right) => right.id - left.id);
      return take === undefined ? newestFirst : newestFirst.slice(0, take);
    },
    findFirst: async ({ where = {} }: Query): Promise<{ id: number } | null> => {
      const found = audits.some(
        (row) =>
          row.entity === where.entity && row.verb === where.verb && row.entity_id === where.entity_id,
      );
      return found ? { id: 1 } : null;
    },
  };

  void nextPushId;
  return {
    prisma: { security_findings, security_waivers, audit_log, admins: { findMany: async (): Promise<Row[]> => [] } },
    messages,
    audits,
    seedFinding: (seed: Row): void => {
      findings.push({
        id: nextFindingId,
        source: 'rootfs',
        kind: 'os-package',
        severity: 'HIGH',
        subject: 'openssl',
        installed: '1.0',
        available: null,
        title: null,
        url: null,
        host: 'box-a',
        reachability: 'unknown',
        detail: null,
        first_seen: new Date('2026-11-01T00:00:00.000Z'),
        last_seen: new Date('2026-11-12T03:00:00.000Z'),
        resolved_at: null,
        ...seed,
      });
      nextFindingId += 1;
    },
    seedWaiver: (seed: Row): void => {
      waivers.push({
        id: waivers.length + 1,
        ended_at: null,
        reason: 'test decision',
        created_at: new Date('2026-10-01T00:00:00.000Z'),
        created_by: 1,
        ...seed,
      });
    },
    seedPush: (push: { host: string | null; runStartedAt: Date; at: Date; source?: string }): void => {
      pushes.push({
        id: nextPushId,
        timestamp: push.at,
        entity: 'security_findings',
        verb: 'security.findings.ingest',
        after_values: {
          host: push.host,
          source: push.source ?? 'rootfs',
          run_started_at: push.runStartedAt.toISOString(),
        },
      });
      nextPushId += 1;
    },
    recordAudit: vi.fn(async (entry: {
      verb: string; entity: string; entityId?: string; result: string;
      reason?: string; afterValues?: unknown;
    }): Promise<void> => {
      audits.push({
        verb: entry.verb,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        result: entry.result,
        reason: entry.reason ?? null,
        afterValues: entry.afterValues,
      });
    }),
    logToDiscord: vi.fn(async (
      title: string, body: string, color: number, mention: boolean, footer?: string,
    ): Promise<boolean> => {
      messages.push({ title, body, color, mention, footer });
      return await deliver();
    }),
    setDelivery: (next: () => Promise<boolean>): void => {
      deliver = next;
    },
    webhookConfigured: (): boolean => webhook,
    setWebhook: (next: boolean): void => {
      webhook = next;
    },
    reset: (): void => {
      findings.length = 0;
      waivers.length = 0;
      pushes.length = 0;
      audits.length = 0;
      messages.length = 0;
      nextFindingId = 1;
      nextPushId = 1;
      deliver = async () => true;
      webhook = true;
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: store.prisma }));
vi.mock('@/lib/audit', () => ({ recordAudit: store.recordAudit }));
vi.mock('@/lib/discord-notifier', () => ({
  logToDiscord: store.logToDiscord,
  isDiscordWebhookConfigured: (): boolean => store.webhookConfigured(),
}));
vi.mock('@/lib/security/staleness', () => ({
  readStalenessSnapshotCached: async (): Promise<{ readings: never[]; source: null }> => ({ readings: [], source: null }),
}));

const { announceFinishedScans, SCAN_NOTIFIED_VERB, SCAN_NOTIFY_FAILED_VERB } = await import(
  '@/lib/security/scan-notify'
);
const { readPatchingPage, readPatchingSnapshot } = await import('@/lib/security/patching-read');
const { SCAN_REPORT_COLOR } = await import('@/lib/security/scan-report');

const RUN_AT = new Date('2026-11-12T03:00:00.000Z');
const TICK = new Date('2026-11-12T03:06:00.000Z');
const MINUTE = 60_000;

function at(minutes: number, seconds = 0): Date {
  return new Date(RUN_AT.getTime() + minutes * MINUTE + seconds * 1000);
}

/** One line of the fenced block, as a number: the message's own rendering, not the facts behind it. */
function blockValue(body: string, label: string): number {
  const block = body.split('```')[1].split('\n').slice(1, -1);
  const line = block.find((entry) => entry.startsWith(label));
  if (line === undefined) throw new Error(`no ${label} line in ${body}`);
  return Number(line.slice(5).replace(/,/g, '').trim());
}

function seedSingleRun(host = 'box-a'): void {
  store.seedPush({ host, runStartedAt: RUN_AT, at: at(0, 10) });
}

describe('the scan announcement is composed by the poller, one message per run', () => {
  beforeEach(() => {
    store.reset();
    store.recordAudit.mockClear();
    store.logToDiscord.mockClear();
  });

  it('(a) sends ONE message for a run whose two sources pushed separately', async () => {
    store.seedFinding({ source: 'rootfs', key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    store.seedFinding({ source: 'osv', key: 'GHSA-2222|left-pad', severity: 'MEDIUM', subject: 'left-pad' });
    store.seedPush({ host: 'box-a', runStartedAt: RUN_AT, at: at(0, 10), source: 'rootfs' });
    store.seedPush({ host: 'box-a', runStartedAt: RUN_AT, at: at(0, 40), source: 'osv' });

    const results = await announceFinishedScans(TICK);

    expect(store.messages).toHaveLength(1);
    expect(results).toEqual([{ key: `box-a|${RUN_AT.toISOString()}`, status: 'sent' }]);
    // Both sources are in the one message: the run's list, not a producer's slice of it.
    expect(store.messages[0].body).toContain('**2 standing**');
    expect(blockValue(store.messages[0].body, 'HIGH')).toBe(1);
    expect(blockValue(store.messages[0].body, 'MED')).toBe(1);
  });

  it('(b) never names a waived CVE, and still counts the waivers it stands on', async () => {
    store.seedWaiver({ source: 'rootfs', match: 'CVE-2023-53867', review_by: new Date('2027-01-31T00:00:00.000Z') });
    store.seedFinding({
      key: 'CVE-2023-53867|libxml2', severity: 'CRITICAL', subject: 'libxml2', reachability: 'reachable',
    });
    store.seedFinding({
      key: 'CVE-2024-0001|glibc', severity: 'CRITICAL', subject: 'glibc', reachability: 'unreachable',
    });
    seedSingleRun();

    await announceFinishedScans(TICK);

    const [message] = store.messages;
    expect(message.title).toBe('1 unwaived CRITICAL · box-a');
    expect(message.body).not.toContain('53867');
    expect(message.body).toContain('**CVE-2024-0001** · glibc');
    expect(message.body).toContain('waived 1 · next review 2027-01-31');
  });

  it('(c) prints the page’s unwaived numbers, not the raw open rows', async () => {
    store.seedWaiver({ source: 'rootfs', match: 'CVE-2026-9001', review_by: new Date('2027-03-01T00:00:00.000Z') });
    store.seedWaiver({ source: 'rootfs', match: 'CVE-2026-9400', review_by: new Date('2027-03-01T00:00:00.000Z') });
    store.seedFinding({ key: 'CVE-2026-9001|openssl', severity: 'HIGH', subject: 'openssl' });
    store.seedFinding({ key: 'CVE-2026-9002|bash', severity: 'HIGH', subject: 'bash' });
    store.seedFinding({ key: 'CVE-2026-9003|zlib', severity: 'HIGH', subject: 'zlib' });
    store.seedFinding({ key: 'CVE-2026-9400|perl', severity: 'CRITICAL', subject: 'perl' });
    store.seedFinding({ key: 'CVE-2026-9401|sudo', severity: 'CRITICAL', subject: 'sudo', reachability: 'reachable' });
    store.seedFinding({ key: 'CVE-2026-9100|perl', severity: 'MEDIUM', subject: 'perl' });
    store.seedFinding({ key: 'CVE-2026-9101|curl', severity: 'MEDIUM', subject: 'curl' });
    store.seedFinding({ key: 'CVE-2026-9200|sudo', severity: null, subject: 'sudo' });
    store.seedFinding({ source: 'osv', key: 'GHSA-3333|axios', severity: 'MEDIUM', subject: 'axios' });
    store.seedFinding({
      source: 'osv', key: 'GHSA-4444|express', severity: 'HIGH', subject: 'express', reachability: 'reachable',
    });
    seedSingleRun();

    await announceFinishedScans(TICK);

    const [message] = store.messages;
    const page = await readPatchingPage({}, TICK);
    const snapshot = await readPatchingSnapshot(TICK);
    // The page's own rendering of the same store: every row with the waiver verdict it shows.
    const unwaived = page.groups.flatMap((group) => group.findings).filter(
      (finding) => finding.waiver.status !== 'active',
    );
    const pageCount = (severity: string): number =>
      unwaived.filter((finding) => finding.severity === severity).length;

    expect(blockValue(message.body, 'HIGH')).toBe(pageCount('HIGH'));
    expect(blockValue(message.body, 'HIGH')).toBe(snapshot.signal.counts.unwaivedHigh);
    // One of the four HIGH rows is covered, so the message says 3 — the raw count would be 4.
    expect(blockValue(message.body, 'HIGH')).toBe(3);
    expect(blockValue(message.body, 'MED')).toBe(pageCount('MEDIUM'));
    expect(blockValue(message.body, 'LOW')).toBe(pageCount('LOW'));
    expect(blockValue(message.body, 'UNK')).toBe(unwaived.length - pageCount('CRITICAL') - pageCount('HIGH')
      - pageCount('MEDIUM') - pageCount('LOW'));
    // The standing total is every unwaived row the page lists, criticals included.
    expect(message.body).toContain(`**${String(unwaived.length)} standing**`);
    // One of the two CRITICALs is covered, so the title names the other and not both.
    expect(pageCount('CRITICAL')).toBe(1);
    expect(message.title).toBe('1 unwaived CRITICAL · box-a');
  });

  it('(d) renders a clean run as the short form, with no named rows', async () => {
    store.seedWaiver({ source: 'rootfs', match: 'CVE-2026-8001', review_by: new Date('2027-01-31T00:00:00.000Z') });
    store.seedWaiver({ source: 'rootfs', match: 'CVE-2026-8002', review_by: new Date('2027-01-31T00:00:00.000Z') });
    store.seedFinding({ host: 'box-b', key: 'CVE-2026-8001|openssl', severity: 'HIGH', subject: 'openssl' });
    store.seedFinding({ host: 'box-b', key: 'CVE-2026-8002|bash', severity: 'CRITICAL', subject: 'bash' });
    store.seedPush({ host: 'box-b', runStartedAt: RUN_AT, at: at(0, 10) });

    await announceFinishedScans(TICK);

    const [message] = store.messages;
    expect(message.title).toBe('nothing unwaived · box-b');
    expect(message.color).toBe(SCAN_REPORT_COLOR);
    expect(message.mention).toBe(false);
    expect(message.body.split('\n')[0]).toBe('**0 standing** · 0 new · nothing needs you');
    // Two levels only: the lead and the counts block — L3 has nothing to name and says nothing.
    expect(message.body.split('\n')[1]).toBe('```');
    expect(message.body).not.toContain('…and');
    expect(blockValue(message.body, 'HIGH')).toBe(0);
    expect(message.body).toContain('waived 2');
  });

  it('(e) stays silent for a re-push of the same run, and speaks again for a new one', async () => {
    store.seedFinding({ key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    seedSingleRun();

    await announceFinishedScans(TICK);
    // The producer re-pushes the same run five minutes later (a retried batch, a second source).
    store.seedPush({ host: 'box-a', runStartedAt: RUN_AT, at: at(9, 0), source: 'osv' });
    const again = await announceFinishedScans(at(12));

    expect(again).toEqual([{ key: `box-a|${RUN_AT.toISOString()}`, status: 'already-sent' }]);
    expect(store.messages).toHaveLength(1);

    // A new run always speaks, even though the list it describes is unchanged.
    store.seedPush({ host: 'box-a', runStartedAt: at(60), at: at(60, 30) });
    const next = await announceFinishedScans(at(66));

    expect(next).toEqual([{ key: `box-a|${at(60).toISOString()}`, status: 'sent' }]);
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1].footer).toContain('run 2026-11-12 04:00 UTC');
  });

  it('waits for the quiet window before speaking about a run still pushing', async () => {
    store.seedFinding({ key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    seedSingleRun();

    expect(await announceFinishedScans(at(1))).toEqual([]);
    expect(store.messages).toHaveLength(0);
    // 121 s after the last batch: the run is finished.
    expect(await announceFinishedScans(at(2, 11))).toHaveLength(1);
  });

  it('lets the newest run for a box supersede an older one that never spoke', async () => {
    store.seedFinding({ key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    store.seedPush({ host: 'box-a', runStartedAt: RUN_AT, at: at(0, 10) });
    store.seedPush({ host: 'box-a', runStartedAt: at(3), at: at(4, 0) });

    // The older run is quiet, but the newer one is not: neither speaks yet.
    expect(await announceFinishedScans(at(5))).toEqual([]);
    const results = await announceFinishedScans(at(6, 30));

    expect(results).toEqual([{ key: `box-a|${at(3).toISOString()}`, status: 'sent' }]);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].footer).toContain('run 2026-11-12 03:03 UTC');
  });

  it('records a swallowed message as a failure and keeps the run retryable', async () => {
    store.seedFinding({ key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    seedSingleRun();
    store.setDelivery(async () => false);

    expect(await announceFinishedScans(TICK)).toEqual([
      { key: `box-a|${RUN_AT.toISOString()}`, status: 'failed' },
    ]);
    // The next tick retries, and one broken run leaves one failure row, not one per minute.
    expect(await announceFinishedScans(new Date(TICK.getTime() + MINUTE))).toEqual([
      { key: `box-a|${RUN_AT.toISOString()}`, status: 'failed' },
    ]);
    expect(store.audits).toEqual([
      expect.objectContaining({ verb: SCAN_NOTIFY_FAILED_VERB, entity_id: `box-a|${RUN_AT.toISOString()}` }),
    ]);

    store.setDelivery(async () => true);
    expect(await announceFinishedScans(TICK)).toEqual([
      { key: `box-a|${RUN_AT.toISOString()}`, status: 'sent' },
    ]);
    expect(store.audits.filter((row) => row.verb === SCAN_NOTIFIED_VERB)).toEqual([
      expect.objectContaining({ result: 'success' }),
    ]);
  });

  it('says nothing at all when no webhook is configured — the page is the only surface', async () => {
    store.seedFinding({ key: 'CVE-2026-0001|openssl', severity: 'HIGH', subject: 'openssl' });
    seedSingleRun();
    store.setWebhook(false);

    expect(await announceFinishedScans(TICK)).toEqual([]);
    expect(store.messages).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });
});
