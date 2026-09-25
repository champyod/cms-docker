import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { buildRoute } from '@/lib/navigation/routes';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import type { PermissionRequirement } from '@/lib/navigation/types';

const CONTEST_TAB_PERMISSIONS = {
  'contests.tabs.overview': { all: ['contest:read'] },
  'contests.tabs.tasks': { all: ['contest:read', 'task:read'] },
  'contests.tabs.participants': { all: ['contest:read', 'participation:read', 'user:read'] },
  'contests.tabs.communications': { all: ['contest:read', 'announcement:read', 'question:read', 'ranking:read'] },
  'contests.tabs.settings': { all: ['contest:read'] },
} as const satisfies Readonly<Record<string, PermissionRequirement>>;

describe('contest detail canonical paths', () => {
  it('builds every approved Contest path with locale preserved', () => {
    expect(buildRoute('en', 'contests.tabs.overview', { id: 41 })).toBe('/en/contests/41/overview');
    expect(buildRoute('th', 'contests.tabs.tasks', { id: 41 })).toBe('/th/contests/41/tasks');
    expect(buildRoute('en', 'contests.tabs.participants', { id: 41 })).toBe('/en/contests/41/participants');
    expect(buildRoute('en', 'contests.tabs.communications', { id: 41 })).toBe('/en/contests/41/communications');
    expect(buildRoute('en', 'contests.tabs.settings', { id: 41 })).toBe('/en/contests/41/settings');
  });

  it('keeps each descriptor permission equal to its tab read owner', () => {
    for (const [routeId, permission] of Object.entries(CONTEST_TAB_PERMISSIONS)) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      expect(route?.permission).toEqual(permission);
    }
  });

  it('conceals each tab for a partial read set without leaking action rights', () => {
    for (const [routeId, requiredKeys] of Object.entries(CONTEST_TAB_PERMISSIONS)) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      if (!route) throw new Error(`Missing Contest tab descriptor: ${routeId}`);
      expect(isRoutePermitted(route, new Set(requiredKeys.all ?? []))).toBe(true);
      for (const missingKey of requiredKeys.all ?? []) {
        const partialKeys = (requiredKeys.all ?? []).filter((key) => key !== missingKey);
        expect(isRoutePermitted(route, new Set(partialKeys))).toBe(false);
      }
    }

    const settings = ROUTE_REGISTRY.find((route) => route.id === 'contests.tabs.settings');
    expect(settings?.permission).toEqual({ all: ['contest:read'] });
    expect(settings?.permission.all).not.toContain('contest:update');
    expect(CONTEST_TAB_PERMISSIONS['contests.tabs.participants'].all ?? []).not.toContain('participation:create');
    expect(CONTEST_TAB_PERMISSIONS['contests.tabs.tasks'].all ?? []).not.toContain('task:update');
  });

  it('keeps English and Thai Contest detail-label keys in parity', () => {
    const expected = ['overview', 'tasks', 'participants', 'communications', 'settings'];
    expect(Object.keys(en.navigation.contests.tabs)).toEqual(expected);
    expect(Object.keys(th.navigation.contests.tabs)).toEqual(expected);
    expect(Object.keys(en.navigation.contests.record)).toEqual(['label']);
    expect(Object.keys(th.navigation.contests.record)).toEqual(['label']);
  });
});
