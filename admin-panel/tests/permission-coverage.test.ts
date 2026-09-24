import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_REGISTRY, RESERVED_PERMISSIONS } from '@/lib/permission-registry';
import { DEFAULT_GROUPS } from '@/lib/permission-groups';
import { FIELD_PERMISSION_MAP } from '@/lib/field-permissions';
import { hasEffectivePermission, resolveEffectivePermissions } from '@/lib/permission-engine';
import { NAV_REGISTRY, visibleEntries } from '@/lib/nav-registry';
import { PERMISSION_TAB_LIST_KEY, permittedTabs } from '@/lib/permission-tabs';
import { ACTIONS_DIR, API_DIR, FOLLOW_FILES, SRC_DIR } from '../scripts/coverage/model';
import { parseFile, listFilesRecursive } from '../scripts/coverage/scan';
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

function exportedFunctions(abs: string): string[] {
  const source = fs.readFileSync(abs, 'utf8');
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = EXPORT_FN_RE.exec(source)) !== null) names.push(match[1]);
  return names;
}

function collectEntries(): { entries: Entry[]; demandedByEntry: Map<string, string[]> } {
  const supportFiles = [...listFilesRecursive(ACTIONS_DIR, '.ts'), ...listFilesRecursive(API_DIR, '.ts'), ...FOLLOW_FILES];
  const parsed = new Map();
  for (const abs of supportFiles) parsed.set(abs, parseFile(abs));
  const fieldSource =
    fs.readFileSync(path.join(SRC_DIR, 'lib', 'field-permissions.ts'), 'utf8') +
    fs.readFileSync(path.join(SRC_DIR, 'lib', 'field-permission-tables.ts'), 'utf8');
  const tables = tableUpdateKeys(fieldSource);
  const entries: Entry[] = [];
  const demandedByEntry = new Map<string, string[]>();
  for (const abs of [...listFilesRecursive(ACTIONS_DIR, '.ts'), ...listFilesRecursive(API_DIR, '.ts')]) {
    const info = parsed.get(abs) as { rel: string };
    for (const fn of exportedFunctions(abs)) {
      const id = `${info.rel}#${fn}`;
      entries.push({ id, file: abs, fn });
      demandedByEntry.set(id, resolveDemanded(abs, fn, parsed, tables));
    }
  }
  return { entries, demandedByEntry };
}

function fieldMapKeys(): Set<string> {
  const keys = new Set<string>();
  for (const fields of Object.values(FIELD_PERMISSION_MAP)) {
    for (const def of Object.values(fields)) {
      keys.add(def.read);
      if (def.update) keys.add(def.update);
    }
  }
  return keys;
}

function componentGateKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const dirs = ['components', 'hooks', 'lib', 'app'].map((d) => path.join(SRC_DIR, d));
  const re = /hasEffectivePermission\s*\([^,]+,\s*'([^']+)'/g;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue;
      const source = fs.readFileSync(abs, 'utf8');
      const keys: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) keys.push(match[1]);
      if (keys.length > 0) found.set(path.relative(SRC_DIR, abs), [...new Set(keys)]);
    }
  };
  for (const dir of dirs) walk(dir);
  return found;
}

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
    const { demandedByEntry } = collectEntries();
    const demanded = new Set<string>();
    for (const keys of demandedByEntry.values()) for (const key of keys) demanded.add(key);
    // Why page gates count: app/[locale] pages are server components, so a
    // checkPermission there is server-side enforcement, not a UX hint.
    const pageGateRe = /\b(?:ensurePermission|checkPermission)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const pagesDir = path.join(SRC_DIR, 'app');
    const walkPages = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkPages(abs); continue; }
        if (!abs.endsWith('.tsx')) continue;
        const source = fs.readFileSync(abs, 'utf8');
        let match: RegExpExecArray | null;
        while ((match = pageGateRe.exec(source)) !== null) demanded.add(match[1]);
      }
    };
    walkPages(pagesDir);
    const mapped = fieldMapKeys();
    const reserved = new Set(RESERVED_PERMISSIONS.map((r) => r.key));
    const ignored = PERMISSION_REGISTRY.map((d) => d.key).filter(
      (key) => key !== 'all:all' && !demanded.has(key) && !mapped.has(key) && !reserved.has(key),
    );
    expect(ignored).toEqual([]);
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
    const { demandedByEntry } = collectEntries();
    const enforced = new Set<string>(fieldMapKeys());
    for (const keys of demandedByEntry.values()) for (const key of keys) enforced.add(key);
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
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!abs.endsWith('.ts')) continue;
        const source = fs.readFileSync(abs, 'utf8');
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
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

  it('gates every nav entry and tab on a registry key', () => {
    const registryKeys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    const offenders: string[] = [];
    for (const entry of NAV_REGISTRY) {
      if (entry.permission && !registryKeys.has(entry.permission)) offenders.push(`${entry.path} -> ${entry.permission}`);
      for (const key of entry.permissions ?? []) {
        if (!registryKeys.has(key)) offenders.push(`${entry.path} -> ${key}`);
      }
    }
    for (const [tab, key] of Object.entries(PERMISSION_TAB_LIST_KEY)) {
      if (!registryKeys.has(key)) offenders.push(`tab:${tab} -> ${key}`);
    }
    expect(offenders).toEqual([]);
  });

  it('hides every gated surface from a keyless caller', () => {
    const empty = new Set<string>();
    for (const entry of visibleEntries(empty)) {
      expect(entry.permission).toBeUndefined();
      expect(entry.permissions).toBeUndefined();
    }
    expect(permittedTabs(empty)).toEqual([]);
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
    const source = fs.readFileSync(path.join(SRC_DIR, 'lib/services/tasks.ts'), 'utf8');
    expect(source).toContain('codename: true, public: true');
  });
  it('prevents group editors from granting powers they lack', (): void => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'app/actions/groups.ts'), 'utf8');
    expect(source).toContain('hasEffectivePermission');
    expect(source).toContain('Cannot grant permissions you do not hold');
  });
});
