import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  where: undefined as unknown,
  countWhere: undefined as unknown,
  skip: 0,
  take: 0,
  ensurePermission: vi.fn(async () => undefined),
  actorNames: vi.fn(async () => new Map<number, string>()),
  entityNames: vi.fn(async () => new Map<string, string>()),
  rows: [] as readonly unknown[],
  total: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: probe.ensurePermission }));
vi.mock('@/lib/admin-names', () => ({ loadActorNames: probe.actorNames }));
vi.mock('@/lib/entity-names', () => ({
  loadEntityNames: probe.entityNames,
  entityNameKey: (entity: string, entityId: string): string => `${entity}:${entityId}`,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    audit_log: {
      findMany: async (args: { where: unknown; skip: number; take: number }) => {
        probe.where = args.where;
        probe.skip = args.skip;
        probe.take = args.take;
        return probe.rows;
      },
      count: async (args: { where: unknown }) => {
        probe.countWhere = args.where;
        return probe.total;
      },
    },
  },
}));

interface WhereClause {
  AND?: { OR?: { verb?: { in?: string[] }; result?: string }[] }[];
  OR?: { verb?: { contains?: string } }[];
  result?: string;
  timestamp?: { gte?: Date; lte?: Date };
}

const AUDIT_ROW = {
  id: BigInt(42),
  actor_id: 4,
  timestamp: new Date('2026-10-14T09:00:00.000Z'),
  verb: 'service:deploy',
  entity: 'deployment',
  entity_id: '3',
  result: 'success',
};

interface AlertQuery {
  page?: number;
  search?: string;
  result?: string;
  fromDate?: string;
  toDate?: string;
}

async function readAlerts(query: AlertQuery = {}) {
  const { getAlertHistory } = await import('@/lib/alert-history');
  return getAlertHistory(query);
}

beforeEach(() => {
  vi.clearAllMocks();
  probe.rows = [];
  probe.total = 0;
  probe.actorNames.mockResolvedValue(new Map([[4, 'Ada']]));
  probe.entityNames.mockResolvedValue(new Map([['deployment:3', 'Midterm']]));
});

describe('alert history reader', () => {
  it('gates the read on audit:read alone', async () => {
    await readAlerts();
    expect(probe.ensurePermission).toHaveBeenCalledWith('audit:read');
  });

  it('narrows the log to the verbs the bell pushes', async () => {
    await readAlerts();
    const where = probe.where as WhereClause;
    const pushed = where.AND?.[0].OR?.[0].verb?.in ?? [];
    expect(pushed).toContain('service:deploy');
    expect(pushed).toContain('admin:delete');
    // Why: a reveal is not an alert on success, so it is not in the pushed set at all.
    expect(pushed).not.toContain('password:reveal');
    expect(where.AND?.[0].OR?.[1]).toEqual({ verb: 'password:reveal', result: 'failure' });
  });

  it('pages from the requested page at the alert page size', async () => {
    const { ALERT_PAGE_SIZE } = await import('@/lib/alert-history');
    await readAlerts({ page: 3 });
    expect(probe.skip).toBe(ALERT_PAGE_SIZE * 2);
    expect(probe.take).toBe(ALERT_PAGE_SIZE);
  });

  it('counts the same rows it reads', async () => {
    await readAlerts();
    expect(probe.countWhere).toEqual(probe.where);
  });

  it('applies the result filter, the search and the day range', async () => {
    await readAlerts({ result: 'failure', search: 'deploy', fromDate: '2026-10-01', toDate: '2026-10-02' });
    const where = probe.where as WhereClause;
    expect(where.result).toBe('failure');
    expect(where.OR?.[0].verb?.contains).toBe('deploy');
    expect(where.timestamp?.gte).toBeInstanceOf(Date);
    expect(where.timestamp?.lte).toBeInstanceOf(Date);
  });

  it('reports names and totals for one page of rows', async () => {
    probe.rows = [AUDIT_ROW];
    probe.total = 26;
    const result = await readAlerts();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.total).toBe(26);
    expect(result.data.totalPages).toBe(2);
    expect(result.data.entries).toEqual([
      {
        id: '42',
        timestamp: '2026-10-14T09:00:00.000Z',
        verb: 'service:deploy',
        entity: 'deployment',
        entity_name: 'Midterm',
        actor_name: 'Ada',
        result: 'success',
      },
    ]);
  });

  it('fails closed when the gate refuses the caller', async () => {
    probe.ensurePermission.mockRejectedValueOnce(new Error('Unauthorized: Missing audit:read permission'));
    const result = await readAlerts();
    expect(result).toEqual({ success: false, error: 'Unauthorized: Missing audit:read permission' });
  });
});
