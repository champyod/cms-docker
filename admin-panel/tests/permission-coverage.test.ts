import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_REGISTRY, RESERVED_PERMISSIONS } from '@/lib/permission-registry';
import { DEFAULT_GROUPS } from '@/lib/permission-groups';
import { FIELD_PERMISSION_MAP } from '@/lib/field-permissions';
import { hasEffectivePermission, resolveEffectivePermissions } from '@/lib/permission-engine';
import { ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import type { PermissionRequirement } from '@/lib/navigation/types';
import { ACTIONS_DIR, API_DIR, FOLLOW_FILES, PERMISSIONS_FILE, SRC_DIR, type FileInfo } from '../scripts/coverage/model';
import { parseActionPermissions, parseFile, listFilesRecursive } from '../scripts/coverage/scan';
import { resolveDemanded, tableUpdateKeys, isAllowlisted } from '../scripts/coverage/resolve';

// Why this tester: every action permission must be alive (enforced), every
// field must carry a read/update key, all:all must expand safely, and every
// frontend surface must filter on the same keys — verified in one run.

const EXPORT_FN_RE = /export\s+async\s+function\s+(\w+)/g;

interface Entry {
  id: string;
  file: string;
  fn: string;
}

interface EntryScan {
  entries: Entry[];
  demandedByEntry: Map<string, string[]>;
}

/**
 * Why a memo and not a recompute: every scan below reads the same immutable
 * `src` tree, so running one per assertion multiplied a read-only walk by the
 * assertion count. Consumers only read the result, so a single shared snapshot
 * holds and the first caller pays the walk.
 */
function once<T>(compute: () => T): () => T {
  let slot: { value: T } | null = null;
  return (): T => {
    slot ??= { value: compute() };
    return slot.value;
  };
}

/**
 * Why one shared snapshot: the frontend, page, and strip walks below all
 * traverse overlapping parts of `src`, and `app` is read by two of them. A
 * process-wide source cache turns each file into a single read for the run.
 */
const readSource = once((): ((abs: string) => string) => {
  const cache = new Map<string, string>();
  return (abs: string): string => {
    const hit = cache.get(abs);
    if (hit !== undefined) return hit;
    const source = fs.readFileSync(abs, 'utf8');
    cache.set(abs, source);
    return source;
  };
});

function exportedFunctions(source: string): string[] {
  const names: string[] = [];
  EXPORT_FN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_FN_RE.exec(source)) !== null) names.push(match[1]);
  return names;
}

const entryFiles = (): string[] => [
  ...listFilesRecursive(ACTIONS_DIR, '.ts'),
  ...listFilesRecursive(API_DIR, '.ts'),
];

function fieldPermissionSources(): string {
  return (
    fs.readFileSync(path.join(SRC_DIR, 'lib', 'field-permissions.ts'), 'utf8') +
    fs.readFileSync(path.join(SRC_DIR, 'lib', 'field-permission-tables.ts'), 'utf8')
  );
}

const collectEntries = once((): EntryScan => {
  const entryPaths = new Set(entryFiles());
  const parsed = new Map<string, FileInfo>();
  for (const abs of [...entryPaths, ...FOLLOW_FILES]) parsed.set(abs, parseFile(abs, parseActionPermissions(PERMISSIONS_FILE)));
  const tables = tableUpdateKeys(fieldPermissionSources());
  const entries: Entry[] = [];
  const demandedByEntry = new Map<string, string[]>();
  for (const [abs, info] of parsed) {
    if (!entryPaths.has(abs)) continue;
    for (const fn of exportedFunctions(info.source)) {
      const id = `${info.rel}#${fn}`;
      entries.push({ id, file: abs, fn });
      demandedByEntry.set(id, resolveDemanded(abs, fn, parsed, tables));
    }
  }
  return { entries, demandedByEntry };
});

const fieldMapKeys = once((): Set<string> => {
  const keys = new Set<string>();
  for (const fields of Object.values(FIELD_PERMISSION_MAP)) {
    for (const def of Object.values(fields)) {
      keys.add(def.read);
      if (def.update) keys.add(def.update);
    }
  }
  return keys;
});

const componentGateKeys = once((): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  const dirs = ['components', 'hooks', 'lib', 'app'].map((d) => path.join(SRC_DIR, d));
  const re = /hasEffectivePermission\s*\([^,]+,\s*'([^']+)'/g;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue;
      const source = readSource()(abs);
      const keys: string[] = [];
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) keys.push(match[1]);
      if (keys.length > 0) found.set(path.relative(SRC_DIR, abs), [...new Set(keys)]);
    }
  };
  for (const dir of dirs) walk(dir);
  return found;
});

// Why page gates count: app/[locale] pages are server components, so a
// permission check there is server-side enforcement, not a UX hint. The
// matcher lists the same helpers as the shared coverage scanner, because a
// page that gates with the typed reader is enforcing, not hinting.
const PAGE_GATE_RE = /\b(?:ensurePermission|checkPermission|requirePermission)\s*\(\s*['"`]([^'"`]+)['"`]/g;

// Why descriptor gates count: a module page that authorizes through
// authorizeRoutePage enforces the requirement its registry descriptor declares,
// so the descriptor is the enforcement site and the source holds only the id.
const ROUTE_GATE_RE = /\bauthorizeRoutePage\s*\(\s*['"`]([^'"`]+)['"`]/g;

/** The descriptor fields a page gate reads: its id, its enabled state, and its requirement. */
interface GateDescriptor {
  readonly id: string;
  readonly enabled: boolean;
  readonly permission: PermissionRequirement;
}

// Why the enabled check mirrors `authorizeRoutePage`: it 404s a missing or
// disabled descriptor before it reads a permission, so a page gating one never
// reaches a permission check. Counting its keys would let a dead route keep a
// registry key looking enforced and hide it from the gate below.
function enforcedKeysForGatedRoutes(
  gatedRouteIds: readonly string[],
  registry: readonly GateDescriptor[],
): Set<string> {
  const keys = new Set<string>();
  for (const routeId of gatedRouteIds) {
    const descriptor = registry.find((route) => route.id === routeId);
    if (!descriptor) throw new Error(`Gated page names an undeclared route: ${routeId}`);
    if (!descriptor.enabled) continue;
    for (const key of [...(descriptor.permission.all ?? []), ...(descriptor.permission.any ?? [])]) {
      keys.add(key);
    }
  }
  return keys;
}

const descriptorGateKeys = once((): Set<string> => {
  const gatedRouteIds: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!abs.endsWith('.tsx')) continue;
      const source = readSource()(abs);
      ROUTE_GATE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ROUTE_GATE_RE.exec(source)) !== null) gatedRouteIds.push(match[1]);
    }
  };
  walk(path.join(SRC_DIR, 'app'));
  return enforcedKeysForGatedRoutes(gatedRouteIds, ROUTE_REGISTRY);
});

const pageGateKeys = once((): Set<string> => {
  const keys = descriptorGateKeys();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!abs.endsWith('.tsx')) continue;
      const source = readSource()(abs);
      PAGE_GATE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PAGE_GATE_RE.exec(source)) !== null) keys.add(match[1]);
    }
  };
  walk(path.join(SRC_DIR, 'app'));
  return keys;
});

const enforcedKeys = once((): Set<string> => {
  const { demandedByEntry } = collectEntries();
  const enforced = new Set(fieldMapKeys());
  for (const keys of demandedByEntry.values()) for (const key of keys) enforced.add(key);
  for (const key of pageGateKeys()) enforced.add(key);
  return enforced;
});

describe('permission coverage', () => {
  it('gates every server action and API entry (or allowlists it with a reason)', () => {
    const { entries, demandedByEntry } = collectEntries();
    expect(entries.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const entry of entries) {
      const demanded = demandedByEntry.get(entry.id) ?? [];
      if (demanded.length === 0 && !isAllowlisted(entry.id)) offenders.push(entry.id);
    }
    expect(offenders).toEqual([]);
  });

  it('demands only keys present in the registry', () => {
    const { demandedByEntry } = collectEntries();
    const registryKeys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    const unknown: string[] = [];
    for (const [id, keys] of demandedByEntry) {
      for (const key of keys) if (!registryKeys.has(key)) unknown.push(`${id} -> ${key}`);
    }
    expect(unknown).toEqual([]);
  });

  it('enforces every registry key or documents it as system-owned', () => {
    const demanded = enforcedKeys();
    const mapped = fieldMapKeys();
    const reserved = new Set(RESERVED_PERMISSIONS.map((r) => r.key));
    const ignored = PERMISSION_REGISTRY.map((d) => d.key).filter(
      (key) => key !== 'all:all' && !demanded.has(key) && !mapped.has(key) && !reserved.has(key),
    );
    expect(ignored).toEqual([]);
  });

  it('leaves a disabled descriptor key unenforced so the registry gate still fires', () => {
    const key = 'system:disabled-probe';
    const registry: readonly GateDescriptor[] = [
      { id: 'system.enabled-probe', enabled: true, permission: { all: [key] } },
      { id: 'system.disabled-probe', enabled: false, permission: { all: [key] } },
    ];
    // Why the enabled twin: it holds descriptor.enabled as the only difference,
    // so the disabled case cannot pass by counting nothing at all.
    expect([...enforcedKeysForGatedRoutes(['system.enabled-probe'], registry)]).toEqual([key]);

    const enforced = enforcedKeys();
    for (const contributed of enforcedKeysForGatedRoutes(['system.disabled-probe'], registry)) {
      enforced.add(contributed);
    }
    // A key no enforcing site covers is exactly what the gate above reports, so
    // a page gated only by a disabled descriptor leaves its requirement visible.
    expect(enforced.has(key)).toBe(false);
  });

  it('grants every enforced key to at least one group', () => {
    const { demandedByEntry } = collectEntries();
    const enforced = new Set<string>(fieldMapKeys());
    for (const keys of demandedByEntry.values()) for (const key of keys) enforced.add(key);
    const granted = new Set<string>();
    for (const group of DEFAULT_GROUPS) for (const key of group.permissions) granted.add(key);
    // Why backup:* exempt: manual-grant-only by design (per-person override or
    // direct link), never inherited — not even Superadmin holds them.
    const unreachable = [...enforced].filter(
      (key) => key !== 'all:all' && !key.startsWith('backup:') && !granted.has(key),
    );
    expect(unreachable).toEqual([]);
  });

  it('documents every granted-but-unenforced key as system-owned', () => {
    const enforced = enforcedKeys();
    const reserved = new Set(RESERVED_PERMISSIONS.map((r) => r.key));
    const offenders: string[] = [];
    for (const group of DEFAULT_GROUPS) {
      if (group.name === 'Superadmin') continue;
      for (const key of group.permissions) {
        if (!enforced.has(key) && !reserved.has(key)) offenders.push(`${group.name} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('maps every field def to a registry key', () => {
    const registryKeys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    const offenders: string[] = [];
    for (const [entity, fields] of Object.entries(FIELD_PERMISSION_MAP)) {
      for (const [field, def] of Object.entries(fields)) {
        if (!registryKeys.has(def.read)) offenders.push(`${entity}.${field}.read -> ${def.read}`);
        if (def.update && !registryKeys.has(def.update)) offenders.push(`${entity}.${field}.update -> ${def.update}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('strips only entities present in the field map', () => {
    const entities = new Set(Object.keys(FIELD_PERMISSION_MAP));
    const offenders: string[] = [];
    const re = /stripDisallowedFields\s*\(\s*'([^']+)'/g;
    const srcDir = SRC_DIR;
    const source = readSource();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!abs.endsWith('.ts')) continue;
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source(abs))) !== null) {
          if (!entities.has(match[1])) offenders.push(`${path.relative(srcDir, abs)} -> ${match[1]}`);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it('expands all:all safely with deny-wins and no backup grant', () => {
    const effective = resolveEffectivePermissions(['all:all'], []);
    for (const d of PERMISSION_REGISTRY) {
      if (d.key.startsWith('backup:')) {
        expect(hasEffectivePermission(effective, d.key)).toBe(false);
      } else {
        expect(hasEffectivePermission(effective, d.key)).toBe(true);
      }
    }
    const denied = resolveEffectivePermissions(['all:all'], [{ permissionKey: 'contest:read', effect: 'deny' }]);
    expect(hasEffectivePermission(denied, 'contest:read')).toBe(false);
    expect(hasEffectivePermission(denied, 'contest:list')).toBe(true);
    expect(hasEffectivePermission(new Set(['all:all']), 'task:delete')).toBe(true);
    expect(hasEffectivePermission(new Set(), 'task:read')).toBe(false);
  });

  it('gates every route descriptor on a registry key', () => {
    const registryKeys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    const offenders: string[] = [];
    for (const route of ROUTE_REGISTRY) {
      for (const key of [...(route.permission.all ?? []), ...(route.permission.any ?? [])]) {
        if (!registryKeys.has(key)) offenders.push(`${route.id} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('hides every gated surface from a keyless caller', () => {
    const empty = new Set<string>();
    // Why the ID set and not the per-route shape: visibleRoutes already filters on
    // isRoutePermitted, and a requirement-free route is permitted for anyone, so
    // asserting an empty requirement per visible route holds by construction. The
    // exact visible ID set is the form that can actually fail when a route is
    // enabled whose gate does not reach the sidebar surface. Home and Docs are the
    // two authenticated-public targets, so a keyless caller sees exactly those.
    expect(visibleRoutes(empty, 'sidebar').map((route) => route.id)).toEqual(['home', 'system.docs']);
  });

  it('uses only registry keys in frontend permission checks', () => {
    const registryKeys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    const offenders: string[] = [];
    for (const [file, keys] of componentGateKeys()) {
      for (const key of keys) if (!registryKeys.has(key)) offenders.push(`${file} -> ${key}`);
    }
    expect(offenders).toEqual([]);
  });
  it('requires compound permissions for dataset activation', (): void => {
    const source = fs.readFileSync(path.join(API_DIR, 'datasets/[id]/route.ts'), 'utf8');
    expect(source).toContain("verifyApiPermission('dataset:switch')");
    expect(source).toContain("verifyApiPermission('task:switch_dataset')");
  });
  it('applies testcase field permissions in the API path', (): void => {
    const source = fs.readFileSync(path.join(API_DIR, 'testcases/route.ts'), 'utf8');
    expect(source).toContain('stripDisallowedFields');
  });
  it('loads testcase visibility for task detail', (): void => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'lib/queries/task-detail.ts'), 'utf8');
    expect(source).toContain('codename: true, public: true');
  });
  it('prevents group editors from granting powers they lack', (): void => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'app/actions/groups.ts'), 'utf8');
    expect(source).toContain('hasEffectivePermission');
    expect(source).toContain('Cannot grant permissions you do not hold');
  });
});
