import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import {
  callerCanGrant,
  isEffectiveSuperset,
  resolveEffectivePermissions,
} from '@/lib/permission-engine';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf-8');
}

describe('admin mutation guard wiring (static)', () => {
  it('admins.ts wires isEffectiveSuperset and getTargetEffectivePermissions', () => {
    const src = readSource('src/app/actions/admins.ts');
    expect(src).toContain('isEffectiveSuperset');
    expect(src).toContain('getTargetEffectivePermissions');
    expect(src).toContain('guardAdminMutation');
  });

  it('adminPermissions.ts wires callerCanGrant via resulting-set checks', () => {
    const src = readSource('src/app/actions/adminPermissions.ts');
    expect(src).toContain('canCallerGrantResult');
    expect(src).toContain('effectiveAfterGroupChange');
    expect(src).toContain('effectiveAfterOverride');
    expect(src).toContain('resultingEffective');
  });

  it('does not bypass helpers with inline all:all checks', () => {
    const adminsSrc = readSource('src/app/actions/admins.ts');
    const permSrc = readSource('src/app/actions/adminPermissions.ts');
    // Why: helpers already handle all:all expansion — inline reimplementations would drift
    expect(adminsSrc).not.toMatch(/effective\.has\(['"]all:all['"]\)/);
    expect(permSrc).not.toMatch(/effective\.has\(['"]all:all['"]\)/);
  });
});

describe('defect 1 — admin:update may not mutate higher-privileged admins', () => {
  it('blocks admin:update-only caller from editing Superadmin', () => {
    const caller = new Set<string>(['admin:update']);
    const target = new Set<string>(PERMISSION_REGISTRY.map((d) => d.key));
    expect(isEffectiveSuperset(caller, target)).toBe(false);
  });

  it('blocks when target holds any permission the caller lacks', () => {
    const caller = new Set<string>(['admin:update', 'admin:read']);
    const target = new Set<string>(['admin:update', 'contest:create']);
    expect(isEffectiveSuperset(caller, target)).toBe(false);
  });

  it('allows self-edit (subset is trivially true when sets equal)', () => {
    const caller = new Set<string>(['admin:update', 'group:assign']);
    const target = new Set<string>(['admin:update']);
    expect(isEffectiveSuperset(caller, target)).toBe(true);
  });

  it('allows caller with all:all to edit Superadmin (no over-blocking)', () => {
    const caller = new Set<string>(['all:all']);
    const target = new Set<string>(PERMISSION_REGISTRY.map((d) => d.key));
    expect(isEffectiveSuperset(caller, target)).toBe(true);
  });

  it('handles raw all:all target as full registry (special-case)', () => {
    const callerWithoutAll = new Set<string>(['admin:update']);
    const rawAllTarget = new Set<string>(['all:all']);
    expect(isEffectiveSuperset(callerWithoutAll, rawAllTarget)).toBe(false);

    const callerWithAll = new Set<string>(['all:all']);
    expect(isEffectiveSuperset(callerWithAll, rawAllTarget)).toBe(true);
  });
});

describe('defect 2a — group:assign may not grant permissions outside caller', () => {
  it('blocks group:assign holder from gaining Superadmin group', () => {
    const caller = new Set<string>(['group:assign']);
    const resulting = new Set<string>(PERMISSION_REGISTRY.map((d) => d.key));
    expect(callerCanGrant(caller, [...resulting])).toBe(false);
  });

  it('blocks when resulting set contains any key caller lacks', () => {
    const caller = new Set<string>(['group:assign', 'contest:read']);
    const resulting = resolveEffectivePermissions(['contest:read', 'admin:delete'], []);
    expect(callerCanGrant(caller, [...resulting])).toBe(false);
  });

  it('allows all:all caller to assign Superadmin (no over-blocking)', () => {
    const caller = new Set<string>(['all:all']);
    const resulting = new Set<string>(PERMISSION_REGISTRY.map((d) => d.key));
    expect(callerCanGrant(caller, [...resulting])).toBe(true);
  });

  it('allowlisted subset passes when caller holds those keys', () => {
    const caller = new Set<string>(['group:assign', 'contest:read', 'contest:list']);
    const resulting = resolveEffectivePermissions(['contest:read', 'contest:list'], []);
    expect(callerCanGrant(caller, [...resulting])).toBe(true);
  });
});

describe('defect 2b — override:set may not grant all:all or keys outside caller', () => {
  it('blocks override:set holder from granting all:all on self', () => {
    const caller = new Set<string>(['override:set']);
    const resulting = resolveEffectivePermissions(['all:all'], []);
    expect(callerCanGrant(caller, [...resulting])).toBe(false);
  });

  it('blocks when override would grant a key caller lacks', () => {
    const caller = new Set<string>(['override:set', 'contest:read']);
    const resulting = new Set<string>(['contest:read', 'admin:delete']);
    expect(callerCanGrant(caller, [...resulting])).toBe(false);
  });

  it('allows all:all caller to grant all:all override (no over-blocking)', () => {
    const caller = new Set<string>(['all:all']);
    expect(callerCanGrant(caller, ['all:all'])).toBe(true);
    const resulting = resolveEffectivePermissions(['all:all'], []);
    expect(callerCanGrant(caller, [...resulting])).toBe(true);
  });

  it('deny override does not require grant check (deny reduces set)', () => {
    const caller = new Set<string>(['override:set', 'contest:read']);
    const resulting = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'admin:delete', effect: 'deny' },
    ]);
    // Result still contains many keys, so caller without all:all would still be blocked if checked
    expect(callerCanGrant(caller, [...resulting])).toBe(false);
    const allCaller = new Set<string>(['all:all']);
    expect(callerCanGrant(allCaller, [...resulting])).toBe(true);
  });
});

describe('resulting-set not delta enforcement', () => {
  it('denies when existing permissions already exceed caller', () => {
    // Why: check resulting set, not delta — existing Superadmin perms must be caught
    const caller = new Set<string>(['group:assign', 'contest:read']);
    const existingSuper = new Set<string>(PERMISSION_REGISTRY.map((d) => d.key));
    // Even adding no new group, the resulting set still requires every Superadmin key
    expect(callerCanGrant(caller, [...existingSuper])).toBe(false);
  });

  it('all:all caller may grant any resulting set', () => {
    const caller = new Set<string>(['all:all']);
    for (const key of PERMISSION_REGISTRY.map((d) => d.key)) {
      expect(callerCanGrant(caller, [key])).toBe(true);
    }
  });
});

describe('runtime — mocked server actions enforce guards', () => {
  beforeEach(() => vi.resetModules());

  it('updateAdmin denies when target outranks caller', async () => {
    vi.doMock('@/lib/permissions', async () => {
      const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
      return {
        ...actual,
        ensurePermission: vi.fn(async () => {}),
        getPermissions: vi.fn(async () => new Set<string>(['admin:update'])),
      };
    });
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn(async () => ({ userId: '1', username: 'caller', expiresAt: new Date().toISOString() })),
    }));
    vi.doMock('@/lib/permission-engine', async () => {
      const actual = await vi.importActual<typeof import('@/lib/permission-engine')>('@/lib/permission-engine');
      return {
        ...actual,
        getTargetEffectivePermissions: vi.fn(async () =>
          new Set<string>(PERMISSION_REGISTRY.map((d) => d.key)),
        ),
      };
    });
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        admins: {
          findUnique: vi.fn(async () => ({ id: 2, enabled: true, admin_groups: [{ groups: { name: 'Superadmin', id: 1 } }] })),
          update: vi.fn(async () => ({})),
          count: vi.fn(async () => 1),
        },
      },
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    vi.doMock('@/lib/field-permissions', async () => {
      const actual = await vi.importActual<typeof import('@/lib/field-permissions')>('@/lib/field-permissions');
      return { ...actual, stripDisallowedFields: vi.fn((_, data) => data) };
    });
    vi.doMock('@/lib/admin-helpers', async () => {
      const actual = await vi.importActual<typeof import('@/lib/admin-helpers')>('@/lib/admin-helpers');
      return {
        ...actual,
        findAdminTarget: vi.fn(async () => ({ id: 2, enabled: true, admin_groups: [{ groups: { name: 'Superadmin', id: 1 } }] })),
        isSelfDemotion: vi.fn(() => false),
        isCurrentlySuperadmin: vi.fn(() => true),
        removesSuperadminStatusViaGroups: vi.fn(() => false),
        wouldRemoveLastSuperadmin: vi.fn(async () => false),
        buildAdminUpdateData: vi.fn(async (d: unknown) => d as Record<string, unknown>),
      };
    });

    const { updateAdmin } = await import('@/app/actions/admins');
    const res = await updateAdmin(2, { name: 'hacked' } as never);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/Cannot mutate/);
  });

  it('setAdminGroups denies when resulting set exceeds caller', async () => {
    vi.doMock('@/lib/permissions', async () => {
      const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
      return {
        ...actual,
        ensurePermission: vi.fn(async () => {}),
        getPermissions: vi.fn(async () => new Set<string>(['group:assign'])),
      };
    });
    vi.doMock('@/lib/admin-permission-guards', async () => {
      const actual = await vi.importActual<typeof import('@/lib/admin-permission-guards')>('@/lib/admin-permission-guards');
      return {
        ...actual,
        effectiveAfterGroupChange: vi.fn(async () => new Set<string>(PERMISSION_REGISTRY.map((d) => d.key))),
        canCallerGrantResult: actual.canCallerGrantResult,
      };
    });
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        admin_groups: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => {}), createMany: vi.fn(async () => {}) },
        groups: { findMany: vi.fn(async () => []) },
        admins: { findUnique: vi.fn(async () => null) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
          fn({ admin_groups: { deleteMany: vi.fn(async () => {}), createMany: vi.fn(async () => {}) } }),
        ),
      },
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));

    const { setAdminGroups } = await import('@/app/actions/adminPermissions');
    const res = await setAdminGroups(1, [1], 'try escalate');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Cannot grant/);
  });

  it('setAdminOverride denies all:all for non-super caller', async () => {
    vi.doMock('@/lib/permissions', async () => {
      const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
      return {
        ...actual,
        ensurePermission: vi.fn(async () => {}),
        getPermissions: vi.fn(async () => new Set<string>(['override:set'])),
      };
    });
    vi.doMock('@/lib/admin-permission-guards', async () => {
      const actual = await vi.importActual<typeof import('@/lib/admin-permission-guards')>('@/lib/admin-permission-guards');
      return {
        ...actual,
        effectiveAfterOverride: vi.fn(async () => new Set<string>(PERMISSION_REGISTRY.map((d) => d.key))),
        canCallerGrantResult: actual.canCallerGrantResult,
      };
    });
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        permissions: { findUnique: vi.fn(async () => ({ id: 1 })) },
        admin_permission_overrides: {
          findUnique: vi.fn(async () => null),
          upsert: vi.fn(async () => ({})),
        },
        admins: { findUnique: vi.fn(async () => null) },
        groups: { findMany: vi.fn(async () => []) },
      },
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));

    const { setAdminOverride } = await import('@/app/actions/adminPermissions');
    const res = await setAdminOverride(1, 'all:all', 'allow', 'escalate');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Cannot grant/);
  });
});
