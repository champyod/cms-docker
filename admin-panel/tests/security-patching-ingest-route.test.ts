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

const mocks = vi.hoisted(() => {
  const rows = new Map<string, FakeFinding>();
  let nextId = 1;
  // The seeded `root` admin the ingest route attributes every push to; `null` models a box
  // where that row is missing, which must refuse the push instead of filing it as NULL.
  let rootAdmin: { id: number } | null = { id: 1 };
  const rowKey = (source: string, key: string): string => `${source}\u0000${key}`;

  const security_findings = {
    upsert: async (args: {
      where: { source_key: { source: string; key: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<FakeFinding> => {
      const { source, key } = args.where.source_key;
      const id = rowKey(source, key);
      const existing = rows.get(id);
      if (existing === undefined) {
        const created: FakeFinding = {
          id: nextId++,
          source,
          key,
          kind: String(args.create.kind),
          severity: (args.create.severity as string | null) ?? null,
          subject: String(args.create.subject),
          installed: (args.create.installed as string | null) ?? null,
          available: (args.create.available as string | null) ?? null,
          title: (args.create.title as string | null) ?? null,
          url: (args.create.url as string | null) ?? null,
          host: (args.create.host as string | null) ?? null,
          detail: args.create.detail,
          first_seen: args.create.first_seen as Date,
          last_seen: args.create.last_seen as Date,
          resolved_at: null,
        };
        rows.set(id, created);
        return created;
      }
      // Prisma's @updatedAt writes last_seen on every update; the fake does the same so an
      // identical re-push is observably "only last_seen changed".
      Object.assign(existing, args.update, { last_seen: new Date() });
      return existing;
    },
    updateMany: async (args: {
      where: {
        source: string;
        resolved_at: null;
        host?: string;
        last_seen?: { lt: Date };
        key?: { notIn: string[] };
      };
      data: { resolved_at: Date };
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const row of rows.values()) {
        if (row.source !== args.where.source || row.resolved_at !== null) continue;
        // The run-scoped predicate: only rows this run did not touch. Without modelling it the
        // suite would pass while the real route resolved an earlier batch's own findings.
        if (args.where.host !== undefined && row.host !== args.where.host) continue;
        if (args.where.last_seen !== undefined && !(row.last_seen < args.where.last_seen.lt)) continue;
        if (args.where.key !== undefined && args.where.key.notIn.includes(row.key)) continue;
        row.resolved_at = args.data.resolved_at;
        count += 1;
      }
      return { count };
    },
  };

  const fakePrisma = {
    security_findings,
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
