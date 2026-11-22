import type { PageArchetype } from '@/components/patterns/page-types';

/**
 * One route, one archetype. This file is the single place a page's structure is declared: the
 * discrepancy gate reads it, so a page cannot quietly keep bespoke layout while claiming to be a
 * list, and a page added without a declaration is a counted debt rather than an invisible one.
 *
 * Route keys are what the file tree produces: `src/app/[locale]/(authenticated)/contests/page.tsx`
 * is `/contests`, and `contests/[id]/page.tsx` is `/contests/:id`.
 */
export const PAGE_ARCHETYPE_BY_ROUTE: Readonly<Record<string, PageArchetype>> = {
  '/': 'dashboard',
  '/people/teams': 'list',
  '/people/users': 'list',
  '/administration/admins': 'list',
  '/contests': 'list',
  '/tasks': 'list',
  '/people/teams/:id/overview': 'detail',
  '/security/tls': 'detail',
  '/security/overview': 'dashboard',
  '/security/patching': 'list',
  '/security/blocks': 'board',
  '/infrastructure/services': 'board',
  '/ranking/users': 'board',
  '/evaluation/lanes': 'list',
  '/evaluation/submissions': 'list',
  '/system/settings': 'settings',
  // A record landing carries no surface either: it resolves the record and forwards to its default
  // tab, which is where the detail actually lives.
  '/people/users/:id': 'redirect',
  // Legacy addresses that forward to their canonical route; they render no surface of their own.
  '/admins': 'redirect',
  '/appearance': 'redirect',
  '/audit': 'redirect',
  '/containers': 'redirect',
  '/deployments': 'redirect',
  '/docs': 'redirect',
  '/groups': 'redirect',
  '/infrastructure/ranking': 'redirect',
  '/maintenance': 'redirect',
  '/permissions': 'redirect',
  '/ranking/settings': 'redirect',
  '/resources': 'redirect',
  '/settings': 'redirect',
  '/submissions': 'redirect',
  '/submissions/lanes': 'redirect',
  '/teams': 'redirect',
  '/users': 'redirect',
};

/** The component a page must render for its archetype; the gate compares against these names. */
export const ARCHETYPE_COMPONENT: Readonly<Record<PageArchetype, string>> = {
  dashboard: 'DashboardPage',
  list: 'ListPage',
  detail: 'DetailPage',
  form: 'FormPage',
  settings: 'SettingsPage',
  board: 'BoardPage',
  // A redirect has no component: the gate checks it renders no page surface at all.
  redirect: '',
};
