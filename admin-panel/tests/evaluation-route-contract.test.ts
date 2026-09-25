import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoute } from '@/lib/navigation/routes';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';

const canonicalEvaluationPaths = [
  'src/app/[locale]/(authenticated)/evaluation/layout.tsx',
  'src/app/[locale]/(authenticated)/evaluation/loading.tsx',
  'src/app/[locale]/(authenticated)/evaluation/error.tsx',
  'src/app/[locale]/(authenticated)/evaluation/not-found.tsx',
  'src/app/[locale]/(authenticated)/evaluation/submissions/page.tsx',
  'src/app/[locale]/(authenticated)/evaluation/lanes/page.tsx',
  'src/app/[locale]/(authenticated)/submissions/page.tsx',
  'src/app/[locale]/(authenticated)/submissions/lanes/page.tsx',
];

describe('Evaluation route contracts', () => {
  it('fails until canonical Evaluation routes and the lane module exist', () => {
    for (const path of canonicalEvaluationPaths) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });

  it('builds the frozen Evaluation routes in both supported locales', () => {
    expect(buildRoute('th', 'evaluation.submissions')).toBe('/th/evaluation/submissions');
    expect(buildRoute('en', 'evaluation.submissions')).toBe('/en/evaluation/submissions');
    expect(buildRoute('en', 'evaluation.submission-record', { id: 19 })).toBe('/en/evaluation/submissions/19');
    expect(buildRoute('th', 'evaluation.lanes')).toBe('/th/evaluation/lanes');
  });

  it('builds all four nested submission tabs from their frozen route IDs', () => {
    expect(buildRoute('en', 'evaluation.submission-tabs.summary', { id: 19 })).toBe('/en/evaluation/submissions/19/summary');
    expect(buildRoute('en', 'evaluation.submission-tabs.results', { id: 19 })).toBe('/en/evaluation/submissions/19/results');
    expect(buildRoute('th', 'evaluation.submission-tabs.logs', { id: 19 })).toBe('/th/evaluation/submissions/19/logs');
    expect(buildRoute('th', 'evaluation.submission-tabs.evaluation', { id: 19 })).toBe('/th/evaluation/submissions/19/evaluation');
  });

  it('resolves old Evaluation paths with the frozen redirect helper', () => {
    expect(resolveLegacyRedirect('th', '/submissions', new Set(['submission:list']))).toBe('/th/evaluation/submissions');
    expect(resolveLegacyRedirect('en', '/submissions/lanes', new Set(['evaluation:list']))).toBe('/en/evaluation/lanes');
  });

  it('conceals an unauthorized legacy Evaluation target', () => {
    expect(resolveLegacyRedirect('en', '/submissions', new Set(['evaluation:list']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/submissions/lanes', new Set(['submission:list']))).toBeNull();
  });
});
