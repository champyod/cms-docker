import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { buildRoute } from '@/lib/navigation/routes';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import type { PermissionRequirement } from '@/lib/navigation/types';

const TASK_TAB_PERMISSIONS = {
  'tasks.tabs.overview': { all: ['task:read', 'statement:read'] },
  'tasks.tabs.datasets': { all: ['task:read', 'dataset:read'] },
  'tasks.tabs.files': { all: ['task:read', 'attachment:read'] },
  'tasks.tabs.settings': { all: ['task:read'] },
} as const satisfies Readonly<Record<string, PermissionRequirement>>;

describe('task detail canonical paths', () => {
  it('builds every approved Task path with locale preserved', () => {
    expect(buildRoute('en', 'tasks.tabs.overview', { id: 19 })).toBe('/en/tasks/19/overview');
    expect(buildRoute('th', 'tasks.tabs.datasets', { id: 19 })).toBe('/th/tasks/19/datasets');
    expect(buildRoute('en', 'tasks.tabs.files', { id: 19 })).toBe('/en/tasks/19/files');
    expect(buildRoute('en', 'tasks.tabs.settings', { id: 19 })).toBe('/en/tasks/19/settings');
  });

  it('keeps each descriptor permission equal to its tab read owner', () => {
    for (const [routeId, permission] of Object.entries(TASK_TAB_PERMISSIONS)) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      expect(route?.permission).toEqual(permission);
    }
  });

  it('conceals each tab for a partial read set without leaking update rights', () => {
    for (const [routeId, requiredKeys] of Object.entries(TASK_TAB_PERMISSIONS)) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      if (!route) throw new Error(`Missing Task tab descriptor: ${routeId}`);
      expect(isRoutePermitted(route, new Set(requiredKeys.all ?? []))).toBe(true);
      for (const missingKey of requiredKeys.all ?? []) {
        const partialKeys = (requiredKeys.all ?? []).filter((key) => key !== missingKey);
        expect(isRoutePermitted(route, new Set(partialKeys))).toBe(false);
      }
    }

    const settings = ROUTE_REGISTRY.find((route) => route.id === 'tasks.tabs.settings');
    expect(settings?.permission).toEqual({ all: ['task:read'] });
    expect(settings?.permission.all).not.toContain('task:update');
    expect(TASK_TAB_PERMISSIONS['tasks.tabs.datasets'].all ?? []).not.toContain('dataset:update');
    expect(TASK_TAB_PERMISSIONS['tasks.tabs.files'].all ?? []).not.toContain('attachment:create');
  });

  it('keeps English and Thai Task detail-label keys in parity', () => {
    const expected = ['overview', 'datasets', 'files', 'settings'];
    expect(Object.keys(en.navigation.tasks.tabs)).toEqual(expected);
    expect(Object.keys(th.navigation.tasks.tabs)).toEqual(expected);
    expect(Object.keys(en.navigation.tasks.record)).toEqual(['label']);
    expect(Object.keys(th.navigation.tasks.record)).toEqual(['label']);
  });
});
