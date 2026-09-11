import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUPS, PERMISSION_REGISTRY } from '@/lib/permission-registry';
import {
  hasEffectivePermission,
  resolveEffectivePermissions,
  summarisePermissionChanges,
  type PermissionOverride,
} from '@/lib/permission-engine';

describe('resolveEffectivePermissions', () => {
  it('unions every group permission key', () => {
    const effective = resolveEffectivePermissions(['a:read', 'b:write'], []);
    expect([...effective].sort()).toEqual(['a:read', 'b:write']);
  });

  it('does not mutate the supplied group keys', () => {
    const keys = ['a:read'];
    resolveEffectivePermissions(keys, [{ permissionKey: 'a:write', effect: 'allow' }]);
    expect(keys).toEqual(['a:read']);
  });

  const overrideCases: { groups: string[]; overrides: PermissionOverride[]; expected: string[] }[] = [
    {
      groups: [],
      overrides: [{ permissionKey: 'a:read', effect: 'allow' }],
      expected: ['a:read'],
    },
    {
      groups: ['a:read'],
      overrides: [{ permissionKey: 'a:read', effect: 'deny' }],
      expected: [],
    },
    {
      groups: ['a:read'],
      overrides: [
        { permissionKey: 'a:read', effect: 'allow' },
        { permissionKey: 'a:read', effect: 'deny' },
      ],
      expected: [],
    },
    {
      groups: ['a:read', 'b:read'],
      overrides: [
        { permissionKey: 'b:read', effect: 'deny' },
        { permissionKey: 'c:read', effect: 'allow' },
      ],
      expected: ['a:read', 'c:read'],
    },
  ];

  it.each(overrideCases)(
    'resolves $groups with $overrides to $expected',
    ({ groups, overrides, expected }) => {
      const effective = resolveEffectivePermissions(groups, overrides);
      expect([...effective].sort()).toEqual([...expected].sort());
    },
  );

  it('is independent of override ordering', () => {
    const forward = resolveEffectivePermissions([], [
      { permissionKey: 'a:read', effect: 'allow' },
      { permissionKey: 'a:read', effect: 'deny' },
    ]);
    const reverse = resolveEffectivePermissions([], [
      { permissionKey: 'a:read', effect: 'deny' },
      { permissionKey: 'a:read', effect: 'allow' },
    ]);
    expect([...forward]).toEqual([...reverse]);
  });
});

describe('hasEffectivePermission', () => {
  const permissionCases: { effective: string[]; key: string; expected: boolean }[] = [
    { effective: ['a:read'], key: 'a:read', expected: true },
    { effective: ['a:read'], key: 'a:update', expected: false },
    { effective: ['a:read'], key: 'all:all', expected: false },
    { effective: ['all:all'], key: 'service:deploy', expected: true },
    { effective: ['all:all'], key: 'unrelated:verb', expected: true },
  ];

  it.each(permissionCases)(
    'hasEffectivePermission($key) against $effective is $expected',
    ({ effective, key, expected }) => {
      expect(hasEffectivePermission(new Set(effective), key)).toBe(expected);
    },
  );
});

describe('all:all deny-wins expansion', () => {
  it('denies a single key under all:all while keeping other keys', () => {
    const effective = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'admin:delete', effect: 'deny' },
    ]);
    expect(hasEffectivePermission(effective, 'admin:delete')).toBe(false);
    expect(hasEffectivePermission(effective, 'admin:read')).toBe(true);
    expect(hasEffectivePermission(effective, 'all:all')).toBe(true);
  });

  it('denying all:all itself revokes every permission', () => {
    const effective = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'all:all', effect: 'deny' },
    ]);
    expect(hasEffectivePermission(effective, 'all:all')).toBe(false);
    expect(hasEffectivePermission(effective, 'admin:delete')).toBe(false);
    expect(hasEffectivePermission(effective, 'contest:list')).toBe(false);
    expect(effective.size).toBe(0);
  });

  it('deny wins over allow for same key under all:all', () => {
    const effective = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'admin:delete', effect: 'allow' },
      { permissionKey: 'admin:delete', effect: 'deny' },
    ]);
    expect(hasEffectivePermission(effective, 'admin:delete')).toBe(false);
  });

  it('deny-wins regardless of override order under all:all', () => {
    const forward = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'admin:delete', effect: 'allow' },
      { permissionKey: 'admin:delete', effect: 'deny' },
    ]);
    const reverse = resolveEffectivePermissions(['all:all'], [
      { permissionKey: 'admin:delete', effect: 'deny' },
      { permissionKey: 'admin:delete', effect: 'allow' },
    ]);
    expect(hasEffectivePermission(forward, 'admin:delete')).toBe(false);
    expect(hasEffectivePermission(reverse, 'admin:delete')).toBe(false);
    expect([...forward].sort()).toEqual([...reverse].sort());
  });

  it('non-all admin exact-key behaviour is unchanged', () => {
    const denied = resolveEffectivePermissions(['a:read'], [
      { permissionKey: 'a:read', effect: 'deny' },
    ]);
    expect(hasEffectivePermission(denied, 'a:read')).toBe(false);
    const allowed = resolveEffectivePermissions(['a:read'], [
      { permissionKey: 'b:write', effect: 'allow' },
    ]);
    expect(hasEffectivePermission(allowed, 'b:write')).toBe(true);
    expect(hasEffectivePermission(allowed, 'a:read')).toBe(true);
  });

  it('resolves all:all via resolveEffectivePermissions, not via shortcut', () => {
    const effective = resolveEffectivePermissions(['all:all'], []);
    expect(hasEffectivePermission(effective, 'service:deploy')).toBe(true);
    expect(hasEffectivePermission(effective, 'all:all')).toBe(true);
  });
});

describe('summarisePermissionChanges', () => {
  it('reports granted and revoked keys as sorted arrays', () => {
    const before = new Set(['a:read', 'b:read', 'c:read']);
    const after = new Set(['a:read', 'b:delete', 'd:create']);
    expect(summarisePermissionChanges(before, after)).toEqual({
      granted: ['b:delete', 'd:create'],
      revoked: ['b:read', 'c:read'],
    });
  });

  it('reports nothing when the sets are identical', () => {
    const before = new Set(['a:read']);
    expect(summarisePermissionChanges(before, new Set(before))).toEqual({ granted: [], revoked: [] });
  });

  it('treats all:all as an ordinary auditable key', () => {
    const before = new Set(['a:read']);
    const after = new Set(['a:read', 'all:all']);
    expect(summarisePermissionChanges(before, after)).toEqual({ granted: ['all:all'], revoked: [] });
  });
});

describe('PERMISSION_REGISTRY', () => {
  it('is non-empty', () => {
    expect(PERMISSION_REGISTRY.length).toBeGreaterThan(0);
  });

  it.each(PERMISSION_REGISTRY)('entry $key equals ${module}:${verb}', (definition) => {
    expect(definition.key).toBe(`${definition.module}:${definition.verb}`);
  });

  it('has unique permission keys', () => {
    const keys = PERMISSION_REGISTRY.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every entry a description', () => {
    const missing = PERMISSION_REGISTRY.filter((definition) => definition.description.length === 0);
    expect(missing).toEqual([]);
  });

  it('contains the all:all entry', () => {
    expect(PERMISSION_REGISTRY.some((definition) => definition.key === 'all:all')).toBe(true);
  });
});

describe('DEFAULT_GROUPS', () => {
  const registryKeys = new Set(PERMISSION_REGISTRY.map((definition) => definition.key));

  it('defines exactly eight groups with unique names', () => {
    expect(DEFAULT_GROUPS).toHaveLength(8);
    const names = DEFAULT_GROUPS.map((group) => group.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(DEFAULT_GROUPS)('group $name only lists keys present in the registry', (group) => {
    const missing = group.permissions.filter((key) => !registryKeys.has(key));
    expect(missing).toEqual([]);
  });

  it('grants Superadmin every registry key', () => {
    const superadmin = DEFAULT_GROUPS.find((group) => group.name === 'Superadmin');
    expect(superadmin).toBeDefined();
    expect(new Set(superadmin?.permissions ?? [])).toEqual(registryKeys);
  });

  it('includes the all:all key for Superadmin', () => {
    const superadmin = DEFAULT_GROUPS.find((group) => group.name === 'Superadmin');
    expect(superadmin?.permissions).toContain('all:all');
  });
});
