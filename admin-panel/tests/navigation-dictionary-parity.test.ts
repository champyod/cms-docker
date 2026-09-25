import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';

const PEOPLE_ROUTE_IDS: readonly RouteId[] = [
  'people.users',
  'people.user-record',
  'people.user-tabs.profile',
  'people.user-tabs.teams',
  'people.user-tabs.history',
  'people.teams',
  'people.team-record',
  'people.team-tabs.overview',
  'people.team-tabs.members',
  'people.team-tabs.contests',
];

const EVALUATION_ROUTE_IDS: readonly RouteId[] = [
  'evaluation.submissions',
  'evaluation.submission-record',
  'evaluation.submission-tabs.summary',
  'evaluation.submission-tabs.results',
  'evaluation.submission-tabs.logs',
  'evaluation.submission-tabs.evaluation',
  'evaluation.lanes',
];

function resolveLabel(dictionary: unknown, labelKey: string): string {
  let current: unknown = dictionary;
  for (const segment of labelKey.split('.')) {
    if (typeof current !== 'object' || current === null) throw new Error(`Missing dictionary key: ${labelKey}`);
    current = Reflect.get(current, segment);
  }
  if (typeof current !== 'string') throw new Error(`Dictionary key is not a label: ${labelKey}`);
  return current;
}

function childKeys(dictionary: unknown, path: string): string[] {
  let current: unknown = dictionary;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) throw new Error(`Missing dictionary path: ${path}`);
    current = Reflect.get(current, segment);
  }
  if (typeof current !== 'object' || current === null) throw new Error(`Dictionary path is not an object: ${path}`);
  return Object.keys(current);
}

describe('people and evaluation bilingual navigation parity', () => {
  it('resolves every People and Evaluation registry label in English and Thai', () => {
    for (const routeId of [...PEOPLE_ROUTE_IDS, ...EVALUATION_ROUTE_IDS]) {
      const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
      if (!route) throw new Error(`Missing route descriptor: ${routeId}`);
      expect(resolveLabel(en, route.labelKey).trim()).not.toBe('');
      expect(resolveLabel(th, route.labelKey).trim()).not.toBe('');
    }
  });

  it('resolves the People and Evaluation group labels bilingually', () => {
    for (const groupId of ['people', 'evaluation'] as const) {
      const group = NAVIGATION_GROUPS.find((candidate) => candidate.id === groupId);
      if (!group) throw new Error(`Missing navigation group: ${groupId}`);
      expect(resolveLabel(en, group.labelKey).trim()).not.toBe('');
      expect(resolveLabel(th, group.labelKey).trim()).not.toBe('');
    }
  });

  it('keeps English and Thai People and Evaluation detail-label keys in parity', () => {
    const cases = [
      ['navigation.people.user-tabs', ['profile', 'teams', 'history']],
      ['navigation.people.team-tabs', ['overview', 'members', 'contests']],
      ['navigation.evaluation.submission-tabs', ['summary', 'results', 'logs', 'evaluation']],
    ] as const;
    for (const [path, expected] of cases) {
      expect(childKeys(en, path)).toEqual([...expected]);
      expect(childKeys(th, path)).toEqual([...expected]);
    }
    expect(childKeys(en, 'navigation.people.user-record')).toEqual(['label']);
    expect(childKeys(th, 'navigation.people.user-record')).toEqual(['label']);
    expect(childKeys(en, 'navigation.evaluation.submission-record')).toEqual(['label']);
    expect(childKeys(th, 'navigation.evaluation.submission-record')).toEqual(['label']);
  });
});
