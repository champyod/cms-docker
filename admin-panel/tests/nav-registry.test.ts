import { describe, expect, it } from 'vitest';
import { Activity } from 'lucide-react';

import { isEntryPermitted, visibleEntries, type NavEntry } from '@/lib/nav-registry';

const SINGLE_KEY_ENTRY: NavEntry = {
  path: '/single',
  label: 'Single',
  icon: Activity,
  group: 'infrastructure',
  permission: 'audit:read',
  exposeIn: ['sidebar'],
};

const ANY_OF_ENTRY: NavEntry = {
  path: '/any',
  label: 'Any',
  icon: Activity,
  group: 'infrastructure',
  permissions: ['admin:list', 'group:list'],
  exposeIn: ['sidebar'],
};

const OPEN_ENTRY: NavEntry = {
  path: '/open',
  label: 'Open',
  icon: Activity,
  group: 'general',
  exposeIn: ['sidebar'],
};

describe('isEntryPermitted', () => {
  it('treats a single permission as required', () => {
    expect(isEntryPermitted(SINGLE_KEY_ENTRY, new Set(['audit:read']))).toBe(true);
    expect(isEntryPermitted(SINGLE_KEY_ENTRY, new Set(['settings:list']))).toBe(false);
  });

  it('accepts any one of several keys', () => {
    expect(isEntryPermitted(ANY_OF_ENTRY, new Set(['admin:list']))).toBe(true);
    expect(isEntryPermitted(ANY_OF_ENTRY, new Set(['group:list']))).toBe(true);
    expect(isEntryPermitted(ANY_OF_ENTRY, new Set(['settings:list']))).toBe(false);
  });

  it('leaves an entry without a requirement visible', () => {
    expect(isEntryPermitted(OPEN_ENTRY, new Set())).toBe(true);
  });

  it('honours the superadmin bypass for an any-of entry', () => {
    expect(isEntryPermitted(ANY_OF_ENTRY, new Set(['all:all']))).toBe(true);
  });
});

describe('visibleEntries after merging the permissions pages', () => {
  const sidebarPaths = (permissionKeys: string[]): string[] =>
    visibleEntries(new Set(permissionKeys), 'sidebar').map((entry) => entry.path);

  it('keeps /permissions on either list key and hides it without both', () => {
    expect(sidebarPaths(['admin:list'])).toContain('/permissions');
    expect(sidebarPaths(['group:list'])).toContain('/permissions');
    expect(sidebarPaths(['audit:read'])).not.toContain('/permissions');
  });

  it('no longer offers the two absorbed routes', () => {
    const superadminPaths = sidebarPaths(['all:all']);
    expect(superadminPaths).not.toContain('/admins');
    expect(superadminPaths).not.toContain('/groups');
  });

  it('leaves the other single-key entries unchanged', () => {
    const adminOnly = sidebarPaths(['admin:list']);
    expect(adminOnly).not.toContain('/audit');
    expect(adminOnly).not.toContain('/settings');
  });
});
