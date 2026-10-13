import { describe, expect, it } from 'vitest';
import { RESERVED_PERMISSIONS } from '@/lib/permission-registry';
import { DEFAULT_GROUPS } from '@/lib/permission-groups';
import { SEEDED_GROUPS } from './fixtures/seeded-groups';

// Why a pinned roster: the seed reconciles every group to DEFAULT_GROUPS and deletes
// surplus links, so a key drifting out of this file silently rewrites live grants.

// Data Correction is the one group whose roster keeps a resource-owned key:
// evaluation:update is the worker's scoring write.
const RETAINED_RESERVED_KEYS: Readonly<Record<string, readonly string[]>> = {
  'Data Correction': ['evaluation:update'],
};

describe('seeded group roster', () => {
  it('seeds the sixteen code groups besides the separately seeded root actor', () => {
    const names = DEFAULT_GROUPS.map((group) => group.name);
    expect(DEFAULT_GROUPS).toHaveLength(16);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(['Superadmin', ...Object.keys(SEEDED_GROUPS)].sort());
  });

  it.each(Object.entries(SEEDED_GROUPS))('%s holds exactly its roster keys', (name, expected) => {
    const group = DEFAULT_GROUPS.find((candidate) => candidate.name === name);
    expect(group).toBeDefined();
    expect([...(group?.permissions ?? [])].sort()).toEqual([...expected].sort());
  });

  it('seeds the renamed groups and nothing under their old names', () => {
    const names = new Set(DEFAULT_GROUPS.map((group) => group.name));
    for (const renamed of ['Storage', 'Security', 'Participant Manager']) {
      expect(names.has(renamed)).toBe(true);
    }
    for (const stale of ['Storage Admin', 'Security Admin', 'User & participant']) {
      expect(names.has(stale)).toBe(false);
    }
  });

  it('keeps Participant Manager off the login gate', () => {
    const group = DEFAULT_GROUPS.find((candidate) => candidate.name === 'Participant Manager');
    expect(group?.permissions).not.toContain('admin:login');
  });

  it('reconciles Scoreboard Console from code', () => {
    const group = DEFAULT_GROUPS.find((candidate) => candidate.name === 'Scoreboard Console');
    expect(group?.permissions).toEqual(['ranking:read']);
  });

  it('holds a resource-owned key only where its roster keeps one', () => {
    const reserved = new Set(RESERVED_PERMISSIONS.map((entry) => entry.key));
    const offenders: string[] = [];
    for (const group of DEFAULT_GROUPS) {
      if (group.name === 'Superadmin') continue;
      const retained = new Set(RETAINED_RESERVED_KEYS[group.name] ?? []);
      for (const key of group.permissions) {
        if (reserved.has(key) && !retained.has(key)) offenders.push(`${group.name} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
