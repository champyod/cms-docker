import { beforeEach, describe, expect, it, vi } from 'vitest';

const TARGET_ROW = { id: 2, enabled: true, admin_groups: [], name: 'Target', username: 'target' };

interface AuditCall {
  verb: string;
  afterValues?: unknown;
}

interface Harness {
  updateAdmin: typeof import('@/app/actions/admins').updateAdmin;
  writtenData: Record<string, unknown>[];
  auditEntries: AuditCall[];
}

/** Loads the admins action module with the caller's keys and the target row's keys mocked. */
async function loadUpdateAdmin(
  callerPermissions: string[],
  targetPermissions: string[],
): Promise<Harness> {
  const writtenData: Record<string, unknown>[] = [];
  const auditEntries: AuditCall[] = [];

  vi.doMock('@/lib/permissions', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
    return { ...actual, getPermissions: vi.fn(async () => new Set<string>(callerPermissions)) };
  });
  vi.doMock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ userId: '1', username: 'caller', expiresAt: new Date().toISOString() })),
  }));
  vi.doMock('@/lib/permission-engine', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permission-engine')>('@/lib/permission-engine');
    return {
      ...actual,
      getTargetEffectivePermissions: vi.fn(async () => ({
        status: 'resolved' as const,
        effective: new Set<string>(targetPermissions),
      })),
    };
  });
  vi.doMock('@/lib/prisma', () => ({
    prisma: {
      admins: {
        findUnique: vi.fn(async () => TARGET_ROW),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => {
          writtenData.push(args.data);
          return {};
        }),
        count: vi.fn(async () => 1),
      },
    },
  }));
  vi.doMock('@/lib/audit', () => ({
    recordAudit: vi.fn(async (entry: AuditCall) => {
      auditEntries.push(entry);
    }),
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));

  const { updateAdmin } = await import('@/app/actions/admins');
  return { updateAdmin, writtenData, auditEntries };
}

describe('admin:password:update gates credential writes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lets a credential-only caller reset a password and audits it without the secret', async () => {
    const { updateAdmin, writtenData, auditEntries } = await loadUpdateAdmin(
      ['admin:password:update'],
      ['admin:password:update'],
    );

    const result = await updateAdmin(2, { name: 'Renamed', password: 'secret123' } as never);

    expect(result).toEqual({ success: true });
    expect(writtenData).toHaveLength(1);
    expect(writtenData[0].name).toBeUndefined();
    expect(String(writtenData[0].authentication)).toMatch(/^bcrypt:/);

    expect(auditEntries.map((entry) => entry.verb)).toEqual(['admin:update', 'admin:password:update']);
    expect(auditEntries[1].afterValues).toEqual({ passwordChanged: true });
    expect(JSON.stringify(auditEntries)).not.toContain('secret123');
  });

  it('refuses a credential for a caller holding only admin:update', async () => {
    const { updateAdmin, writtenData, auditEntries } = await loadUpdateAdmin(['admin:update'], ['admin:update']);

    const result = await updateAdmin(2, { password: 'secret123' } as never);

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to change these fields',
    });
    expect(writtenData).toEqual([]);
    expect(auditEntries).toEqual([]);
  });

  it('refuses a caller holding neither admin:update nor admin:password:update', async () => {
    const { updateAdmin, writtenData } = await loadUpdateAdmin(['admin:read'], ['admin:read']);

    const result = await updateAdmin(2, { name: 'Renamed', password: 'secret123' } as never);

    expect(result).toEqual({ success: false, error: 'Not authorized' });
    expect(writtenData).toEqual([]);
  });
});
