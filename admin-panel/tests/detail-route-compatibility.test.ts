import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoute } from '@/lib/navigation/routes';
import { parseRecordId } from '@/lib/queries/record-access';

const contestKeys = [
  'contests.tabs.overview',
  'contests.tabs.tasks',
  'contests.tabs.participants',
  'contests.tabs.communications',
  'contests.tabs.settings',
] as const;
const taskKeys = ['tasks.tabs.overview', 'tasks.tabs.datasets', 'tasks.tabs.files', 'tasks.tabs.settings'] as const;

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

describe('legacy record bookmarks', () => {
  it('redirects the old Contest landing shape to Overview without changing locale', () => {
    expect(buildRoute('th', 'contests.tabs.overview', { id: 'abc' })).toBe('/th/contests/abc/overview');
  });

  it('redirects the old Task landing shape to Overview without changing locale', () => {
    expect(buildRoute('th', 'tasks.tabs.overview', { id: 'abc' })).toBe('/th/tasks/abc/overview');
  });

  it('rejects prefix, zero, negative, and non-decimal record IDs', () => {
    expect(parseRecordId('12abc')).toBeNull();
    expect(parseRecordId('0')).toBeNull();
    expect(parseRecordId('-4')).toBeNull();
    expect(parseRecordId('1e2')).toBeNull();
  });
});

describe('detail landing locale preservation', () => {
  it.each(['en', 'th'] as const)('lands %s Contest root at the %s Overview tab', (locale) => {
    expect(buildRoute(locale, 'contests.tabs.overview', { id: 7 })).toBe(`/${locale}/contests/7/overview`);
  });

  it.each(['en', 'th'] as const)('lands %s Task root at the %s Overview tab', (locale) => {
    expect(buildRoute(locale, 'tasks.tabs.overview', { id: 7 })).toBe(`/${locale}/tasks/7/overview`);
  });

  it('keeps every Contest tab descriptor on the same locale-prefixed record', () => {
    for (const key of contestKeys) {
      expect(buildRoute('en', key, { id: 7 })).toMatch(/^\/en\/contests\/7\//);
      expect(buildRoute('th', key, { id: 7 })).toMatch(/^\/th\/contests\/7\//);
    }
  });

  it('keeps every Task tab descriptor on the same locale-prefixed record', () => {
    for (const key of taskKeys) {
      expect(buildRoute('en', key, { id: 7 })).toMatch(/^\/en\/tasks\/7\//);
      expect(buildRoute('th', key, { id: 7 })).toMatch(/^\/th\/tasks\/7\//);
    }
  });
});

describe('detail landing route files', () => {
  const contestPage = readSource('src/app/[locale]/(authenticated)/contests/[id]/page.tsx');
  const taskPage = readSource('src/app/[locale]/(authenticated)/tasks/[id]/page.tsx');

  it('redirects the Contest landing through the frozen Overview route', () => {
    expect(contestPage).toContain("redirect(buildRoute(locale, 'contests.tabs.overview', { id: contestId }))");
  });

  it('redirects the Task landing through the frozen Overview route', () => {
    expect(taskPage).toContain("redirect(buildRoute(locale, 'tasks.tabs.overview', { id: taskId }))");
  });

  it('does not render the deleted Contest monolith', () => {
    expect(contestPage).not.toContain('ContestDetailView');
    expect(contestPage).not.toContain('TaskDetailView');
  });

  it('does not render the deleted Task monolith', () => {
    expect(taskPage).not.toContain('TaskDetailView');
    expect(taskPage).not.toContain('ContestDetailView');
  });

  it('keeps query-string tabs out of the migrated landing files', () => {
    expect(contestPage).not.toContain('?tab=');
    expect(taskPage).not.toContain('?tab=');
  });
});
