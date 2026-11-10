import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Why a fake store and not the real Prisma client: the route's contract is about what it
// does to the table (upsert by identity, resolve only on a complete push, one audit row),
// and an in-memory table lets the suite assert the resulting rows instead of mock call
// shapes that a refactor could satisfy while changing behaviour.
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
  detail: unknown;
  first_seen: Date;
  last_seen: Date;
  resolved_at: Date | null;
}

interface FakeHostModules {
  host: string;
  kernel_release: string;
  loaded: string[];
  blocked: string[];
  recorded_at: Date;
}

type HostModulesWrite = Omit<FakeHostModules, 'host'>;

const mocks = vi.hoisted(() => {
  const rows = new Map<string, FakeFinding>();
  // Keyed by host, because that is the table's primary key: one row per box, replaced in place.
  const hostRows = new Map<string, {
    host: string;
    kernel_release: string;
    loaded: string[];
    blocked: string[];
    recorded_at: Date;
  }>();
  let nextId = 1;
  // The seeded `root` admin the ingest route attributes every push to; `null` models a box
  // where that row is missing, which must refuse the push instead of filing it as NULL.
  let rootAdmin: { id: number } | null = { id: 1 };
  const rowKey = (source: string, key: string): string => `${source}\u0000${key}`;

  const security_findings = {
    // One matcher for both writes the rule makes: the per-finding conditional update and the
    // run-scoped resolution. Modelling `OR`/`last_seen` here is the point — a fake that only
    // recorded the arguments would pass whether the predicate is `resolved_at < runStart` or
    // `resolved_at < now`, and that difference is what keeps a stale run from reopening a row.
    updateMany: async (args: {
      where: {
        source: string;
        resolved_at?: null;
        host?: string;
        last_seen?: { lt: Date };
        key?: string | { notIn: string[] };
        OR?: ReadonlyArray<{ resolved_at: null | { lt: Date } }>;
      };
      data: { resolved_at?: Date | null } & Record<string, unknown>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const row of rows.values()) {
        if (row.source !== args.where.source) continue;
        if (args.where.resolved_at === null && row.resolved_at !== null) continue;
        if (args.where.host !== undefined && row.host !== args.where.host) continue;
        if (args.where.last_seen !== undefined && !(row.last_seen < args.where.last_seen.lt)) continue;
        if (typeof args.where.key === 'string' && row.key !== args.where.key) continue;
        if (
          args.where.key !== undefined
          && typeof args.where.key !== 'string'
          && args.where.key.notIn.includes(row.key)
        ) continue;
        if (args.where.OR !== undefined) {
          const any = args.where.OR.some((clause) =>
            clause.resolved_at === null
              ? row.resolved_at === null
              : row.resolved_at !== null && row.resolved_at < clause.resolved_at.lt,
          );
          if (!any) continue;
        }
        // Prisma writes `last_seen` from the payload here, so the assignment is exactly the
        // update object; `resolved_at` is only in it when the write means to change it.
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    },
    createMany: async (args: {
      data: ReadonlyArray<Record<string, unknown>>;
      skipDuplicates?: boolean;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const datum of args.data) {
        const source = String(datum.source);
        const key = String(datum.key);
        const id = rowKey(source, key);
        if (rows.has(id)) {
          if (args.skipDuplicates === true) continue;
          throw new Error(`unique constraint violated: ${source}/${key}`);
        }
        rows.set(id, {
          id: nextId++,
          source,
          key,
          kind: String(datum.kind),
          severity: (datum.severity as string | null) ?? null,
          subject: String(datum.subject),
          installed: (datum.installed as string | null) ?? null,
          available: (datum.available as string | null) ?? null,
          title: (datum.title as string | null) ?? null,
          url: (datum.url as string | null) ?? null,
          host: (datum.host as string | null) ?? null,
          detail: datum.detail,
          first_seen: datum.first_seen as Date,
          last_seen: datum.last_seen as Date,
          resolved_at: (datum.resolved_at as Date | null) ?? null,
        });
        count += 1;
      }
      return { count };
    },
  };

  const fakePrisma = {
    security_findings,
    // Modelled as a map keyed by host, not as a spy: "replaced, not appended" is the contract.
    security_host_modules: {
      upsert: async (args: {
        where: { host: string };
        create: { host: string } & HostModulesWrite;
        update: HostModulesWrite;
      }): Promise<FakeHostModules> => {
        const existing = hostRows.get(args.where.host);
        const row: FakeHostModules = existing === undefined
          ? { ...args.create }
          : { ...existing, ...args.update };
        hostRows.set(args.where.host, row);
        return row;
      },
    },
    // The ingest route resolves the seeded `root` admin before it writes anything, so the fake
    // has to answer that lookup — and answer "no such admin" on demand, because that case is the
    // one that must refuse the push rather than file it as NULL.
    admins: {
      findUnique: async (): Promise<{ id: number } | null> => rootAdmin,
    },
    $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => run(fakePrisma),
  };

  return {
    rows,
    hostRows,
    rowKey,
    fakePrisma,
    recordAudit: vi.fn(),
    setRootAdmin: (value: { id: number } | null): void => {
      rootAdmin = value;
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.fakePrisma }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

const TOKEN = 'test-feed-token';
const RUN_STARTED_AT = '2026-10-25T00:00:00.000Z';
/** A symbol value is dropped by JSON.stringify, so a test can demand a body with no run start. */
const OMIT_RUN = Symbol('omit-run-start');

function push(body: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}): Request {
  // Every push carries the run start; a body that names it (even with OMIT_RUN) is left alone,
  // which is how the "contract refuses a run-less push" case stays expressible.
  const payload =
    typeof body === 'object' && body !== null && !Array.isArray(body) && !('run_started_at' in body)
      ? { run_started_at: RUN_STARTED_AT, ...body }
      : body;
  return new Request('http://localhost/api/security/findings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'nginx:1.25',
    kind: 'image',
    severity: 'HIGH',
    subject: 'ghcr.io/example/nginx',
    installed: '1.25',
    available: '1.27',
    host: 'box-a',
    ...overrides,
  };
}

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/security/findings/route');
}

async function call(request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await loadRoute();
  const response = await POST(request as never);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('security feed ingest route', () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.hostRows.clear();
    mocks.recordAudit.mockClear();
    mocks.setRootAdmin({ id: 1 });
    process.env.SECURITY_FEED_TOKEN = TOKEN;
    return import('@/lib/security/patching-ingest').then((module) => module.resetFeedRateLimits());
  });

  afterEach(() => {
    delete process.env.SECURITY_FEED_TOKEN;
    vi.clearAllMocks();
  });

  it('rejects a missing, malformed or wrong bearer token with 401', async () => {
    const none = await call(push({ source: 'diun', findings: [] }, null));
    const wrong = await call(push({ source: 'diun', findings: [] }, 'not-the-token'));
    const malformed = await call(push({ source: 'diun', findings: [] }, null, { authorization: TOKEN }));

    expect([none.status, wrong.status, malformed.status]).toEqual([401, 401, 401]);
    expect(mocks.rows.size).toBe(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses every request when SECURITY_FEED_TOKEN is unset', async () => {
    delete process.env.SECURITY_FEED_TOKEN;
    const result = await call(push({ source: 'diun', findings: [] }));
    expect(result.status).toBe(401);
  });

  it('accepts a push with 201 and writes exactly one audit row naming the source as actor', async () => {
    const result = await call(push({ source: 'diun', host: 'box-a', findings: [finding()], complete: true }));

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ success: true, source: 'diun', received: 1, resolved: 0, complete: true });
    expect(mocks.rows.size).toBe(1);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        // The trail never files a write as NULL: the row is attributed to the seeded root admin
        // and names the producer in afterValues, so "who" and "on whose behalf" are both readable.
        actorId: 1,
        verb: 'security.findings.ingest',
        entity: 'security_findings',
        entityId: 'diun',
        afterValues: expect.objectContaining({ actor: 'diun', source: 'diun', received: 1, resolved: 0 }),
      }),
    );
  });

  it('refuses the push and stores nothing when no root actor exists to attribute it to', async () => {
    mocks.setRootAdmin(null);
    const result = await call(push({ source: 'diun', host: 'box-a', findings: [finding()], complete: true }));

    expect(result.status).toBe(500);
    expect(mocks.rows.size).toBe(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('changes only last_seen on an identical re-push', async () => {
    const body = { source: 'osv', findings: [finding({ key: 'CVE-2026-1|left-pad', kind: 'dependency', subject: 'left-pad' })], complete: true };
    await call(push(body));
    const [first] = [...mocks.rows.values()];
    const firstSeen = first.first_seen.getTime();
    const before = { ...first };

    await call(push(body));
    const [second] = [...mocks.rows.values()];

    expect(mocks.rows.size).toBe(1);
    expect(second.first_seen.getTime()).toBe(firstSeen);
    expect(second.last_seen.getTime()).toBeGreaterThanOrEqual(before.last_seen.getTime());
    expect({ ...second, last_seen: null }).toEqual({ ...before, last_seen: null });
    expect(second.resolved_at).toBeNull();
  });

  it('records the envelope host on a finding that does not name one', async () => {
    // Not one mapper in docker/security-scan/lib/*.jq emits a per-finding host, so this is the only
    // shape production ever sends. Storing `finding.host` verbatim meant NULL on every row, and the
    // complete-push resolution — which scopes by the envelope's host — could never match one.
    await call(
      push({
        source: 'rootfs',
        host: 'box-a',
        findings: [finding({ key: 'CVE-2026-2|openssl', host: null })],
        complete: false,
      }),
    );

    const [row] = [...mocks.rows.values()];
    expect(row.host).toBe('box-a');
  });

  it('refuses a push with no run start', async () => {
    // The contract needs the instant the producing run began; a body without it would leave the
    // panel unable to tell "not seen this run" from "sent in an earlier batch".
    const result = await call(
      push({ source: 'rootfs', findings: [finding()], complete: true, run_started_at: OMIT_RUN }),
    );

    expect(result.status).toBe(422);
    expect(mocks.rows.size).toBe(0);
  });

  it('does not resolve rows written earlier in the same run', async () => {
    // Both rows arrive inside one run (one run_started_at), so nothing is resolvable — the shape
    // that used to close 34,500 findings of a 139-batch scan. Resolution across runs is covered in
    // security-patching-ingest-resolve.test.ts, where the timeline is explicit.
    const result = await call(push({ source: 'rootfs', findings: [finding({ key: 'a' })], complete: true }));

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ resolved: 0 });
    const rows = [...mocks.rows.values()];
    expect(rows.find((row) => row.key === 'a')?.resolved_at).toBeNull();
  });

  it('never resolves anything on a partial push', async () => {
    await call(push({ source: 'rootfs', findings: [finding({ key: 'a' }), finding({ key: 'b' })], complete: true }));
    const result = await call(push({ source: 'rootfs', findings: [finding({ key: 'a' })], complete: false }));

    expect(result.body.resolved).toBe(0);
    const rows = [...mocks.rows.values()];
    expect(rows.find((row) => row.key === 'b')?.resolved_at).toBeNull();
  });

  it('answers 422 with the offending finding index', async () => {
    const result = await call(
      push({
        source: 'osv',
        findings: [finding({ key: 'ok' }), finding({ key: 'bad', severity: 'SEVERE' })],
      }),
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ success: false, index: 1 });
    expect(String(result.body.error)).toContain('severity');
    expect(mocks.rows.size).toBe(0);
  });

  it('answers 422 for an unknown source, a non-array findings field and an oversized array', async () => {
    const badSource = await call(push({ source: 'renovate', findings: [] }));
    const badFindings = await call(push({ source: 'diun', findings: {} }));
    const tooMany = await call(push({ source: 'diun', findings: Array.from({ length: 2001 }, (_, index) => finding({ key: `k-${index}` })) }));

    expect([badSource.status, badFindings.status, tooMany.status]).toEqual([422, 422, 422]);
    expect(tooMany.body.index).toBeUndefined();
  });

  it('caps the body before parsing it', async () => {
    const result = await call(push('x'.repeat(1_000_001)));
    expect(result.status).toBe(413);
    expect(mocks.rows.size).toBe(0);
  });

  it('records the host module snapshot as one row, replaced by the next push', async () => {
    const first = await call(
      push({
        source: 'rootfs',
        host: 'box-a',
        findings: [],
        complete: false,
        host_modules: {
          kernel_release: '6.12.9-1-cachyos',
          loaded: ['ksmbd', 'cifs'],
          blocked: ['ceph'],
        },
      }),
    );
    expect(first.status).toBe(201);
    expect(first.body.host_modules).toBe(true);
    expect(mocks.hostRows.size).toBe(1);
    expect(mocks.hostRows.get('box-a')).toMatchObject({
      host: 'box-a',
      kernel_release: '6.12.9-1-cachyos',
      loaded: ['cifs', 'ksmbd'],
      blocked: ['ceph'],
    });

    // A second scan replaces the row, so a module unloaded since must disappear from it.
    await call(
      push({
        source: 'rootfs',
        host: 'box-a',
        findings: [],
        complete: false,
        host_modules: { kernel_release: '6.12.9-1-cachyos', loaded: ['cifs'], blocked: ['ceph'] },
      }),
    );
    expect(mocks.hostRows.size).toBe(1);
    expect(mocks.hostRows.get('box-a')?.loaded).toEqual(['cifs']);
  });

  it('accepts a push from a scanner that sends no host_modules', async () => {
    // The field is newer than the producers: an un-updated image must still land findings and must not erase the state.
    await call(
      push({
        source: 'rootfs',
        host: 'box-a',
        findings: [],
        complete: false,
        host_modules: { kernel_release: '6.12.9-1-cachyos', loaded: ['ksmbd'], blocked: [] },
      }),
    );
    const result = await call(push({ source: 'rootfs', host: 'box-a', findings: [finding()], complete: true }));

    expect(result.status).toBe(201);
    expect(result.body.host_modules).toBe(false);
    expect(mocks.hostRows.size).toBe(1);
    expect(mocks.hostRows.get('box-a')?.loaded).toEqual(['ksmbd']);
  });

  it('refuses host_modules that name no host, and names the reason', async () => {
    const result = await call(
      push({
        source: 'rootfs',
        findings: [],
        host_modules: { kernel_release: '6.12.9-1-cachyos', loaded: [], blocked: [] },
      }),
    );

    expect(result.status).toBe(422);
    expect(String(result.body.error)).toContain('host_modules requires host');
    expect(mocks.hostRows.size).toBe(0);
  });

  it('refuses a malformed host_modules body without storing the findings', async () => {
    const result = await call(
      push({
        source: 'rootfs',
        host: 'box-a',
        findings: [finding()],
        host_modules: { kernel_release: '6.12.9-1-cachyos', loaded: 'ksmbd', blocked: [] },
      }),
    );

    expect(result.status).toBe(422);
    expect(String(result.body.error)).toContain('host_modules.loaded');
    expect(mocks.rows.size).toBe(0);
    expect(mocks.hostRows.size).toBe(0);
  });

  it('rate-limits per source with 429 and a Retry-After header', async () => {
    const { POST } = await loadRoute();
    for (let index = 0; index < 30; index += 1) {
      const accepted = await POST(push({ source: 'osv', findings: [] }) as never);
      expect(accepted.status).toBe(201);
    }

    const limited = await POST(push({ source: 'osv', findings: [] }) as never);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    // The other producers keep their own window.
    const other = await POST(push({ source: 'diun', findings: [] }) as never);
    expect(other.status).toBe(201);
  });
});
