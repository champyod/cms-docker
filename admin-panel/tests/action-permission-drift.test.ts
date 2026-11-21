import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import { ACTION_PERMISSIONS } from '@/lib/permission-engine';
import {
  ACTIONS_DIR,
  API_DIR,
  FOLLOW_FILES,
  PERMISSIONS_FILE,
  SRC_DIR,
  type FileInfo,
} from '../scripts/coverage/model';
import { listFilesRecursive, parseFile, sliceBody } from '../scripts/coverage/scan';

// Why this test exists: ACTION_PERMISSIONS is hand-maintained, so nothing in the
// type system stops an entry from being orphaned, from naming a permission the
// system does not have, or a button from naming an entry that does not exist.
// Because both sides read one map, a wrong value cannot be found by comparing
// them — it can only be found against the registry, so that is what is asserted.

const ENTRY_SOURCES = [
  ...listFilesRecursive(ACTIONS_DIR, '.ts').filter((abs) => !abs.endsWith('.test.ts')),
  ...listFilesRecursive(API_DIR, 'route.ts'),
  ...FOLLOW_FILES,
];

const MAP_SOURCE = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
const MAP_ENTRY_RE = /([A-Za-z_]\w*)\s*:\s*'([^']+)'/g;
const MAP_REFERENCE_RE = /\bACTION_PERMISSIONS\.(\w+)/g;
const GATE_REFERENCE_RE = /\b(?:ensurePermission|checkPermission|verifyApiPermission|requirePermission|hasEffectivePermission)\(\s*[^)]*ACTION_PERMISSIONS\.(\w+)/g;
const LITERAL_GATE_RE = /\bpermission:\s*'[^']+'/g;
const HOOK_LITERAL_GATE_RE = /\bhasEffectivePermission\s*\(\s*\w+\s*,\s*'([^']+)'/g;
const REGISTRY_KEYS = new Set(PERMISSION_REGISTRY.map((entry) => entry.key));

interface Drift {
  readonly action: string;
  readonly detail: string;
}

function readEntries(source: string): Map<string, string> {
  const assignIdx = source.search(/ACTION_PERMISSIONS\s*[:=]/);
  if (assignIdx < 0) return new Map();
  const entries = new Map<string, string>();
  for (const match of sliceBody(source, source.indexOf('{', assignIdx)).matchAll(MAP_ENTRY_RE)) {
    entries.set(match[1], match[2]);
  }
  return entries;
}

function parseEntries(entries: Map<string, string>): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();
  for (const abs of ENTRY_SOURCES) files.set(abs, parseFile(abs, entries));
  return files;
}

function componentSources(): Array<{ rel: string; source: string }> {
  const dir = path.join(SRC_DIR, 'components');
  return [...listFilesRecursive(dir, '.tsx'), ...listFilesRecursive(dir, '.ts')].map((abs) => ({
    rel: path.relative(SRC_DIR, abs),
    source: fs.readFileSync(abs, 'utf8'),
  }));
}

/** Every name a real permission gate reads through the map, across the entry points. */
function gatedNames(files: Map<string, FileInfo>): Set<string> {
  const names = new Set<string>();
  for (const info of files.values()) {
    for (const match of info.source.matchAll(GATE_REFERENCE_RE)) names.add(match[1]);
  }
  return names;
}

function collectEntryDrift(entries: Map<string, string>, gated: Set<string>): Drift[] {
  const drift: Drift[] = [];
  for (const [action, key] of entries) {
    if (!gated.has(action)) drift.push({ action, detail: 'no permission gate reads this entry' });
    if (!REGISTRY_KEYS.has(key)) drift.push({ action, detail: `${key} is not a registered permission` });
  }
  return drift;
}

function collectGateDrift(entries: Map<string, string>, source: string, rel: string): Drift[] {
  const drift: Drift[] = [];
  for (const match of source.matchAll(MAP_REFERENCE_RE)) {
    if (!entries.has(match[1])) drift.push({ action: match[1], detail: `${rel} names an entry the map does not define` });
  }
  for (const match of source.matchAll(LITERAL_GATE_RE)) {
    drift.push({ action: match[0], detail: `${rel} gates a button on a bare key instead of the map` });
  }
  return drift;
}

/**
 * Why the map decides here and the syntax does not: a `.tsx` action descriptor's `permission`
 * field is always an action, but the identical `hasEffectivePermission(effective, 'key')` call in
 * a `.ts` hook also expresses a read or a page-visibility filter that no action owns. Keying the
 * rule to the map's own values keeps it precise — a visibility key the map never claimed is left
 * alone, while a key some entry already claims is a bypass and must read through that entry.
 */
function collectHookGateDrift(entries: Map<string, string>, source: string, rel: string): Drift[] {
  const claimed = new Set(entries.values());
  const drift: Drift[] = [];
  for (const match of source.matchAll(HOOK_LITERAL_GATE_RE)) {
    if (claimed.has(match[1])) {
      drift.push({ action: match[1], detail: `${rel} gates a hook on a bare key instead of the map` });
    }
  }
  return drift;
}

function collectComponentDrift(entries: Map<string, string>, files: Array<{ rel: string; source: string }>): Drift[] {
  return files.flatMap((file) => [
    ...collectGateDrift(entries, file.source, file.rel),
    ...collectHookGateDrift(entries, file.source, file.rel),
  ]);
}

describe('the action/permission map', () => {
  it('is read by a real permission gate, and every entry names a registered permission', () => {
    const entries = readEntries(MAP_SOURCE);
    expect(entries.size).toBe(Object.keys(ACTION_PERMISSIONS).length);
    expect(collectEntryDrift(entries, gatedNames(parseEntries(entries)))).toEqual([]);
  });

  it('fails when an entry names a permission the registry does not have', () => {
    // Why the mutation is derived, not written out: a hardcoded copy of the entry
    // silently stops matching the moment the real map changes, and the test would
    // then pass while proving nothing.
    const corrupted = MAP_SOURCE.replace(/(deleteTask:\s*')[^']+(')/, "$1task:remove$2");
    expect(corrupted).not.toBe(MAP_SOURCE);
    const entries = readEntries(corrupted);
    expect(entries.get('deleteTask')).toBe('task:remove');
    expect(collectEntryDrift(entries, gatedNames(parseEntries(entries))).map((entry) => entry.detail))
      .toContain('task:remove is not a registered permission');
  });

  it('fails when a gate stops reading its entry', () => {
    const entries = readEntries(MAP_SOURCE);
    const files = parseEntries(entries);
    // Why pick a file that actually gates something: the first entry point alphabetically
    // carries no gate, so stripping it would prove nothing.
    const gated = [...files.entries()].find(([, info]) => gatedNames(new Map([[info.rel, info]])).size > 0);
    if (gated === undefined) throw new Error('No entry point reads the action map');
    const [rel, info] = gated;
    const stripped = new Map(files);
    stripped.set(rel, { ...info, source: info.source.replaceAll(/ACTION_PERMISSIONS\.\w+/g, 'SOME_KEY') });
    expect(collectEntryDrift(entries, gatedNames(files))).toEqual([]);
    expect(collectEntryDrift(entries, gatedNames(stripped)).length).toBeGreaterThan(0);
  });

  it('fails when a button gate names an entry the map does not define', () => {
    const entries = readEntries(MAP_SOURCE);
    expect(collectGateDrift(entries, "ensurePermission(ACTION_PERMISSIONS.deleteEveryTask);", 'lib/services/tasks.ts')
      .map((entry) => entry.action)).toEqual(['deleteEveryTask']);
  });

  it('fails when a button gate is a bare key rather than a map entry', () => {
    const entries = readEntries(MAP_SOURCE);
    expect(collectGateDrift(entries, "{ key: 'delete', permission: 'task:update' }", 'components/tasks/TaskList.tsx')).toHaveLength(1);
  });

  it('fails when a hook gate is a bare key rather than a map entry, and spares an unclaimed read key', () => {
    const entries = readEntries(MAP_SOURCE);
    // Why these two: a hook calls hasEffectivePermission for reads and for page visibility as well
    // as for actions, so the proof needs both halves — the claimed key must be caught, and the
    // unclaimed read key must survive, or widening the scan would only trade a blind spot for noise.
    expect(collectHookGateDrift(entries, "hasEffectivePermission(effective, 'group:delete')", 'components/groups/useGroupList.ts'))
      .toHaveLength(1);
    expect(collectHookGateDrift(entries, "hasEffectivePermission(effective, 'contest:list')", 'components/palette/palette-data.ts'))
      .toEqual([]);
  });

  it('leaves no action button or hook gate in the tree gated on a bare key or an undefined entry', () => {
    const entries = readEntries(MAP_SOURCE);
    expect(collectComponentDrift(entries, componentSources())).toEqual([]);
  });
});
