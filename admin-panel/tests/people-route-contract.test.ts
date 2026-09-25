import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoute } from '@/lib/navigation/routes';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';

const canonicalPeoplePaths = [
  'src/app/[locale]/(authenticated)/people/layout.tsx',
  'src/app/[locale]/(authenticated)/people/users/page.tsx',
  'src/app/[locale]/(authenticated)/people/users/[id]/layout.tsx',
  'src/app/[locale]/(authenticated)/people/users/[id]/profile/page.tsx',
  'src/app/[locale]/(authenticated)/people/users/[id]/teams/page.tsx',
  'src/app/[locale]/(authenticated)/people/users/[id]/history/page.tsx',
  'src/components/users/UserProfileTab.tsx',
  'src/components/users/UserTeamsTab.tsx',
  'src/components/users/UserHistoryTab.tsx',
];

describe('People route contracts', () => {
  it('fails until canonical People routes and client components exist', () => {
    for (const path of canonicalPeoplePaths) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });

  it('builds canonical People routes with the frozen builder', () => {
    expect(buildRoute('th', 'people.users')).toBe('/th/people/users');
    expect(buildRoute('en', 'people.user-record', { id: 17 })).toBe('/en/people/users/17');
    expect(buildRoute('en', 'people.user-tabs.history', { id: 17 })).toBe('/en/people/users/17/history');
    expect(buildRoute('en', 'people.team-record', { id: 4 })).toBe('/en/people/teams/4');
    expect(buildRoute('en', 'people.team-tabs.members', { id: 4 })).toBe('/en/people/teams/4/members');
  });

  it('preserves locale and conceals an unauthorized legacy target', () => {
    expect(resolveLegacyRedirect('th', '/users', new Set(['user:list']))).toBe('/th/people/users');
    expect(resolveLegacyRedirect('en', '/users', new Set(['team:list']))).toBeNull();
  });
});

const canonicalTeamPaths = [
  'src/app/[locale]/(authenticated)/people/teams/page.tsx',
  'src/app/[locale]/(authenticated)/people/teams/[id]/layout.tsx',
  'src/app/[locale]/(authenticated)/people/teams/[id]/overview/page.tsx',
  'src/app/[locale]/(authenticated)/people/teams/[id]/members/page.tsx',
  'src/app/[locale]/(authenticated)/people/teams/[id]/contests/page.tsx',
  'src/components/teams/TeamOverviewTab.tsx',
  'src/components/teams/TeamMembersTab.tsx',
  'src/components/teams/TeamContestsTab.tsx',
];

describe('People Team route contracts', () => {
  it('fails until canonical Team routes and client components exist', () => {
    for (const path of canonicalTeamPaths) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });

  it('builds the Team landing and every nested tab with the frozen builder', () => {
    expect(buildRoute('th', 'people.teams')).toBe('/th/people/teams');
    expect(buildRoute('en', 'people.team-record', { id: 4 })).toBe('/en/people/teams/4');
    expect(buildRoute('en', 'people.team-tabs.overview', { id: 4 })).toBe('/en/people/teams/4/overview');
    expect(buildRoute('th', 'people.team-tabs.members', { id: 4 })).toBe('/th/people/teams/4/members');
    expect(buildRoute('en', 'people.team-tabs.contests', { id: 4 })).toBe('/en/people/teams/4/contests');
  });

  it('resolves the old /teams path through the frozen redirect helper', () => {
    expect(resolveLegacyRedirect('th', '/teams', new Set(['team:list']))).toBe('/th/people/teams');
    expect(resolveLegacyRedirect('en', '/teams', new Set(['user:list']))).toBeNull();
  });
});
