import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import en from '@/dictionaries/en.json';
import { buildModuleTabs } from '@/lib/navigation/module-tabs';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { NavigationGroupDescriptor } from '@/lib/navigation/types';

type ModuleGroupId = NavigationGroupDescriptor['id'];

const MODULE_LAYOUTS: readonly { readonly groupId: ModuleGroupId; readonly layoutPath: string }[] = [
  {
    groupId: 'administration',
    layoutPath: 'src/app/[locale]/(authenticated)/administration/layout.tsx',
  },
  {
    groupId: 'infrastructure',
    layoutPath: 'src/app/[locale]/(authenticated)/infrastructure/layout.tsx',
  },
  { groupId: 'system', layoutPath: 'src/app/[locale]/(authenticated)/system/layout.tsx' },
];

const DESCRIPTIONS_DECLARATION = /const\s+\w*escriptions\b[^=]*=\s*{/;
const TAB_ID_CONSTANT = /^[ \t]*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)';/gm;
const MAP_ENTRY_KEY = /^\s*(?:\[([A-Z][A-Z0-9_]*)\]|'([^']*)')\s*:/;

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function objectBody(source: string, declarationIndex: number): string {
  const start = source.indexOf('{', declarationIndex);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return source.slice(start + 1);
}

// Why read the layout instead of importing it: the map is built from the locale dictionary
// inside a server component, so the only reachable statement of which tabs it covers is its
// own source — and an entry only counts as covered when it sits inside that map.
function describedTabIds(source: string): readonly string[] {
  const declarationIndex = source.search(DESCRIPTIONS_DECLARATION);
  if (declarationIndex === -1) return [];
  const constants = new Map<string, string>();
  for (const declaration of source.matchAll(TAB_ID_CONSTANT)) {
    constants.set(declaration[1], declaration[2]);
  }
  const ids: string[] = [];
  for (const line of objectBody(source, declarationIndex).split('\n')) {
    const entry = MAP_ENTRY_KEY.exec(line);
    if (!entry) continue;
    ids.push(entry[1] === undefined ? entry[2] : (constants.get(entry[1]) ?? entry[1]));
  }
  return ids;
}

// Why saturate: hasEffectivePermission grants a key the set names literally, so holding every
// requirement the group's descriptors declare makes the rail render its whole group.
function permissionsPermitting(groupId: ModuleGroupId): ReadonlySet<string> {
  const group = NAVIGATION_GROUPS.find((item) => item.id === groupId);
  if (!group) throw new Error(`Missing navigation group: ${groupId}`);
  const granted = new Set<string>();
  for (const routeId of group.routeIds) {
    const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
    if (!descriptor) throw new Error(`Missing route descriptor: ${routeId}`);
    for (const key of descriptor.permission.all ?? []) granted.add(key);
    for (const key of descriptor.permission.any ?? []) granted.add(key);
  }
  return granted;
}

describe('module tab description coverage', () => {
  it.each(MODULE_LAYOUTS)('$groupId describes every tab its rail can render', (module) => {
    const tabs = buildModuleTabs(
      module.groupId,
      'en',
      en,
      permissionsPermitting(module.groupId),
    );
    expect(tabs.length).toBeGreaterThan(0);
    const described = new Set(describedTabIds(readSource(module.layoutPath)));
    const uncovered = tabs.filter((tab) => !described.has(tab.id)).map((tab) => tab.id);
    expect(uncovered).toEqual([]);
  });

  it('reports a tab whose description line is no longer in the map', () => {
    // The shape of the administration layout minus its audit line: the id is still declared
    // and still on the rail, but nothing in the map names it.
    const sourceWithoutAudit = `
      const ADMINS_TAB_ID = 'administration.admins';
      const GROUPS_TAB_ID = 'administration.groups';
      const AUDIT_TAB_ID = 'administration.audit';
      const descriptions: ModuleTabDescriptions = {
        [ADMINS_TAB_ID]: dict.permissions.subtitle,
        [GROUPS_TAB_ID]: dict['navigation']['administration']['groups']['description'],
      };
    `;
    const described = new Set(describedTabIds(sourceWithoutAudit));
    const uncovered = buildModuleTabs('administration', 'en', en, permissionsPermitting('administration'))
      .filter((tab) => !described.has(tab.id))
      .map((tab) => tab.id);
    expect(uncovered).toEqual(['administration.audit']);
  });

  it('reports every tab when the layout carries no descriptions map at all', () => {
    const described = new Set(describedTabIds('export default function SystemLayout() {}'));
    const uncovered = buildModuleTabs('system', 'en', en, permissionsPermitting('system'))
      .filter((tab) => !described.has(tab.id))
      .map((tab) => tab.id);
    expect(uncovered).toEqual([
      'system.appearance',
      'system.maintenance',
      'system.settings',
      'system.docs',
    ]);
  });
});
