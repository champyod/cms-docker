import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { ACTIONS_DIR, FOLLOW_FILES, PERMISSIONS_FILE, SRC_DIR, type FileInfo } from '../scripts/coverage/model';
import { listFilesRecursive, parseActionPermissions, parseFile } from '../scripts/coverage/scan';
import { resolveDemanded } from '../scripts/coverage/resolve';
import {
  grantedKeys,
  guardedKeys,
  pageReads,
  pageRouteId,
  ungrantedReads,
  type PageScopeFinding,
} from '../scripts/coverage/page-reads';

// Why this test exists: a page's reads gate themselves (`ensurePermission` throws), so a page gated on one key
// that calls a read needing another throws at a reader the navigation just offered the page to. The descriptor is
// the only place that promise is written down, so it is what this compares the reads against.

const permissions = parseActionPermissions(PERMISSIONS_FILE);
const PAGE_DIR = path.join(SRC_DIR, 'app');
const pagePaths = (): string[] => listFilesRecursive(PAGE_DIR, 'page.tsx');

/**
 * Every function's demanded keys, keyed the way an import resolves: `<abs>#<fn>`.
 *
 * Resolved through the coverage resolver, not read off the function body, because an action may gate itself
 * through a local helper (`readPatchingState` -> `requirePatchingRead`) and a body-only read would report it as
 * ungated. The field tables are empty on purpose: they carry `stripDisallowedFields` write keys, and a page
 * strips nothing.
 */
function demandedKeys(): Map<string, readonly string[]> {
  const parsed = new Map<string, FileInfo>();
  const sources = [
    ...listFilesRecursive(ACTIONS_DIR, '.ts').filter((abs) => !abs.endsWith('.test.ts')),
    ...FOLLOW_FILES,
    ...pagePaths(),
  ];
  for (const abs of sources) parsed.set(abs, parseFile(abs, permissions));
  const keys = new Map<string, readonly string[]>();
  for (const abs of sources) {
    for (const name of parsed.get(abs)?.fns.keys() ?? []) {
      keys.set(`${abs}#${name}`, resolveDemanded(abs, name, parsed, new Map()));
    }
  }
  return keys;
}

/** Every page that authorizes through a descriptor, with the reads neither its gate nor its code allows. */
function pageScopeFindings(): PageScopeFinding[] {
  const keys = demandedKeys();
  const findings: PageScopeFinding[] = [];
  for (const abs of pagePaths()) {
    const page: FileInfo = parseFile(abs, permissions);
    const routeId = pageRouteId(page);
    if (routeId === null) continue;
    const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
    expect(descriptor, `${page.rel} authorizes an undeclared route`).toBeDefined();
    if (descriptor === undefined || !descriptor.enabled) continue;
    const reads = pageReads(page, keys);
    for (const read of ungrantedReads(reads, grantedKeys(descriptor.permission), guardedKeys(page))) {
      findings.push({ page: page.rel, routeId, read });
    }
  }
  return findings;
}

/** A page with nothing but the reads under test, so the fixtures below stay readable. */
function fakePage(source: string, imports: Readonly<Record<string, string>>): FileInfo {
  return {
    rel: 'app/fixture/page.tsx',
    source,
    fns: new Map(),
    starAliases: new Map(),
    namedImports: new Map(Object.entries(imports)),
  };
}

const OVERRIDE_KEYS = new Map([['/actions/x.ts#readOverrides', ['ranking:read', 'ranking:override']]]);

describe('page read scope', () => {
  it('grants every key a gated page reads, or guards the read itself', () => {
    const findings = pageScopeFindings().map(
      (finding) =>
        `${finding.page} (${finding.routeId}) calls ${finding.read.action}, which demands ${finding.read.keys.join(', ')}`,
    );
    expect(findings).toEqual([]);
  });

  it('reads a page id and its action calls through the shared matchers', () => {
    const page = fakePage("await authorizeRoutePage('security.blocks');\nawait readOverrides();", {
      readOverrides: '/actions/x.ts#readOverrides',
    });
    expect(pageRouteId(page)).toBe('security.blocks');
    expect(pageReads(page, OVERRIDE_KEYS)).toEqual([
      { action: '/actions/x.ts#readOverrides', keys: ['ranking:read', 'ranking:override'] },
    ]);
  });

  it('reports a read whose key the gate never granted, and passes the one it did', () => {
    const page = fakePage('await readOverrides();', { readOverrides: '/actions/x.ts#readOverrides' });
    const reads = pageReads(page, OVERRIDE_KEYS);
    expect(ungrantedReads(reads, ['ranking:read', 'ranking:override'])).toEqual([]);
    expect(ungrantedReads(reads, ['ranking:read'])).toHaveLength(1);
  });

  it('counts only `all` as a promise, so a key that is merely one alternative does not grant it', () => {
    const requirement = { all: ['security:read'], any: ['ban:read', 'lockout:read'] };
    const reads = [{ action: '/actions/x.ts#readLockouts', keys: ['lockout:read'] }];
    expect(grantedKeys(requirement)).toEqual(['security:read']);
    expect(ungrantedReads(reads, grantedKeys(requirement))).toHaveLength(1);
  });

  it('accepts a read the page guards itself, and still reports the same read without the guard', () => {
    const guarded = fakePage(
      "const canOverride = effective.has('ranking:override');\nconst options = canOverride ? await readOverrides() : null;",
      { readOverrides: '/actions/x.ts#readOverrides' },
    );
    const unguarded = fakePage('await readOverrides();', { readOverrides: '/actions/x.ts#readOverrides' });
    expect(ungrantedReads(pageReads(guarded, OVERRIDE_KEYS), ['ranking:read'], guardedKeys(guarded))).toEqual([]);
    expect(ungrantedReads(pageReads(unguarded, OVERRIDE_KEYS), ['ranking:read'])).toHaveLength(1);
  });

  it('does not count a key named only in a comment as a guard', () => {
    const page = fakePage(
      "// gated on ranking:override elsewhere\nawait readOverrides();",
      { readOverrides: '/actions/x.ts#readOverrides' },
    );
    expect(guardedKeys(page).size).toBe(0);
    expect(ungrantedReads(pageReads(page, OVERRIDE_KEYS), ['ranking:read'], guardedKeys(page))).toHaveLength(1);
  });
});
