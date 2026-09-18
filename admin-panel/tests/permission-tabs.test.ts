import { describe, expect, it } from 'vitest';

import {
  PERMISSION_TAB_LIST_KEY,
  permittedTabs,
  resolvePermissionTab,
} from '@/lib/permission-tabs';

describe('permittedTabs', () => {
  it('gates the admins tab on admin:list alone', () => {
    expect(permittedTabs(new Set(['admin:list']))).toEqual(['admins']);
  });

  it('gates the groups tab on group:list alone', () => {
    expect(permittedTabs(new Set(['group:list']))).toEqual(['groups']);
  });

  it('offers both tabs when both keys are held', () => {
    expect(permittedTabs(new Set(['group:list', 'admin:list']))).toEqual(['admins', 'groups']);
  });

  it('offers no tab without either list key', () => {
    expect(permittedTabs(new Set(['admin:read', 'group:read', 'audit:read']))).toEqual([]);
    expect(permittedTabs(new Set())).toEqual([]);
  });

  it('offers both tabs through the superadmin bypass', () => {
    expect(permittedTabs(new Set(['all:all']))).toEqual(['admins', 'groups']);
  });

  it('pairs each tab with its own list key and nothing else', () => {
    expect(PERMISSION_TAB_LIST_KEY).toEqual({ admins: 'admin:list', groups: 'group:list' });
  });
});

describe('resolvePermissionTab', () => {
  it('selects the tab named in the query', () => {
    expect(resolvePermissionTab('groups', ['admins', 'groups'])).toBe('groups');
    expect(resolvePermissionTab('admins', ['admins', 'groups'])).toBe('admins');
  });

  it('falls back to the first permitted tab for an unknown query value', () => {
    expect(resolvePermissionTab(undefined, ['admins', 'groups'])).toBe('admins');
    expect(resolvePermissionTab('', ['admins', 'groups'])).toBe('admins');
    expect(resolvePermissionTab('bogus', ['admins', 'groups'])).toBe('admins');
  });

  it('never selects a tab the caller cannot read', () => {
    // Why: /admins redirects here with ?tab=admins, so a group-only caller must land on the groups tab.
    expect(resolvePermissionTab('admins', ['groups'])).toBe('groups');
    expect(resolvePermissionTab('groups', ['admins'])).toBe('admins');
  });

  it('resolves to no tab when nothing is permitted', () => {
    expect(resolvePermissionTab('admins', [])).toBeNull();
    expect(resolvePermissionTab(undefined, [])).toBeNull();
  });
});
