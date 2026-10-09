import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import en from '@/dictionaries/en.json';
import { buildModuleFields } from '@/lib/navigation/module-nav';
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
const FIELD_ID_CONSTANT = /^[ \t]*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)';/gm;
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

// The map lives in a server component, so its own source is the only reachable record of what it covers.
function describedFieldIds(source: string): readonly string[] {
  const declarationIndex = source.search(DESCRIPTIONS_DECLARATION);
  if (declarationIndex === -1) return [];
  const constants = new Map<string, string>();
  for (const declaration of source.matchAll(FIELD_ID_CONSTANT)) {
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

// Saturating the set makes every field in the group open, so the whole group renders.
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

describe('module field description coverage', () => {
  it.each(MODULE_LAYOUTS)('$groupId describes every field its shell can render', (module) => {
    const fields = buildModuleFields(
      module.groupId,
      'en',
      en,
      permissionsPermitting(module.groupId),
    );
    expect(fields.length).toBeGreaterThan(0);
    const described = new Set(describedFieldIds(readSource(module.layoutPath)));
    const uncovered = fields.filter((field) => !described.has(field.id)).map((field) => field.id);
    expect(uncovered).toEqual([]);
  });

  it('reports a field whose description line is no longer in the map', () => {
    const sourceWithoutAudit = `
      const ADMINS_FIELD_ID = 'administration.admins';
      const GROUPS_FIELD_ID = 'administration.groups';
      const AUDIT_FIELD_ID = 'administration.audit';
      const descriptions: ModuleDescriptions = {
        [ADMINS_FIELD_ID]: dict.permissions.subtitle,
        [GROUPS_FIELD_ID]: dict['navigation']['administration']['groups']['description'],
      };
    `;
    const described = new Set(describedFieldIds(sourceWithoutAudit));
    const uncovered = buildModuleFields('administration', 'en', en, permissionsPermitting('administration'))
      .filter((field) => !described.has(field.id))
      .map((field) => field.id);
    expect(uncovered).toEqual(['administration.audit']);
  });

  it('reports every field when the layout carries no descriptions map at all', () => {
    const described = new Set(describedFieldIds('export default function SystemLayout() {}'));
    const uncovered = buildModuleFields('system', 'en', en, permissionsPermitting('system'))
      .filter((field) => !described.has(field.id))
      .map((field) => field.id);
    expect(uncovered).toEqual([
      'system.appearance',
      'system.maintenance',
      'system.backup-restore',
      'system.settings',
      'system.docs',
      'system.about',
    ]);
  });
});
