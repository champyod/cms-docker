import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';
import { buildSubmissionTabs } from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/layout';
import SubmissionLandingPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/page';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); }),
}));

vi.mock('@/lib/server/authorization', () => ({
  requirePermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403) {
      super(`Unauthorized: ${status}`);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/evaluation-read-models', () => ({
  getSubmissionSummary: vi.fn(),
  getSubmissionResults: vi.fn(),
  getSubmissionLogs: vi.fn(),
  getSubmissionEvaluation: vi.fn(),
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => en) }));

const RECORD_DIR = 'src/app/[locale]/(authenticated)/evaluation/submissions/[id]';

const CANONICAL_RECORD_PATHS = [
  `${RECORD_DIR}/layout.tsx`,
  `${RECORD_DIR}/page.tsx`,
  `${RECORD_DIR}/not-found.tsx`,
  `${RECORD_DIR}/summary/loading.tsx`,
  `${RECORD_DIR}/summary/page.tsx`,
  `${RECORD_DIR}/results/loading.tsx`,
  `${RECORD_DIR}/results/page.tsx`,
  `${RECORD_DIR}/logs/loading.tsx`,
  `${RECORD_DIR}/logs/page.tsx`,
  `${RECORD_DIR}/evaluation/loading.tsx`,
  `${RECORD_DIR}/evaluation/page.tsx`,
  'src/components/submissions/SubmissionSummaryTab.tsx',
  'src/components/submissions/SubmissionResultsTab.tsx',
  'src/components/submissions/SubmissionLogsTab.tsx',
  'src/components/submissions/SubmissionEvaluationTab.tsx',
  'src/components/submissions/SubmissionActionBar.tsx',
  'src/components/submissions/SubmissionCommentDialog.tsx',
  'src/components/submissions/MoveLaneDialog.tsx',
] as const;

const COMPLETE_RECORD_READER: readonly string[] = [
  'submission:read',
  'submissionresult:read',
  'file:read',
  'evaluation:read',
];

const ALL_TAB_IDS = [
  'evaluation.submission-tabs.summary',
  'evaluation.submission-tabs.results',
  'evaluation.submission-tabs.logs',
  'evaluation.submission-tabs.evaluation',
] as const;

function grant(keys: readonly string[]): void {
  vi.mocked(requirePermission).mockImplementation(async (permission: string) => {
    if (!keys.includes(permission)) throw new AuthorizationError(403);
    return new Set(keys);
  });
}

describe('canonical Submission record routes', () => {
  it('fails until the record route, its four tab routes, and the tab components exist', () => {
    for (const path of CANONICAL_RECORD_PATHS) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });

  it('keeps the same record context when switching summary, results, logs, and evaluation', () => {
    expect([
      buildRoute('en', 'evaluation.submission-tabs.summary', { id: 19 }),
      buildRoute('en', 'evaluation.submission-tabs.results', { id: 19 }),
      buildRoute('en', 'evaluation.submission-tabs.logs', { id: 19 }),
      buildRoute('en', 'evaluation.submission-tabs.evaluation', { id: 19 }),
    ]).toEqual([
      '/en/evaluation/submissions/19/summary',
      '/en/evaluation/submissions/19/results',
      '/en/evaluation/submissions/19/logs',
      '/en/evaluation/submissions/19/evaluation',
    ]);
  });

  it('enables the Submission record landing and its four tabs as physical registry routes', () => {
    const enabledIds = ROUTE_REGISTRY
      .filter((route) => route.id.startsWith('evaluation.submission'))
      .filter((route) => route.enabled)
      .map((route) => route.id);
    expect(enabledIds).toEqual([
      'evaluation.submissions',
      'evaluation.submission-record',
      'evaluation.submission-tabs.summary',
      'evaluation.submission-tabs.results',
      'evaluation.submission-tabs.logs',
      'evaluation.submission-tabs.evaluation',
    ]);
  });

  it('keeps query-string tab selection out of every Submission record file', () => {
    for (const path of CANONICAL_RECORD_PATHS.filter((entry) => entry.startsWith(RECORD_DIR))) {
      expect(readFileSync(join(process.cwd(), path), 'utf8'), path).not.toContain('?tab=');
    }
  });
});

describe('Submission record tab rail', () => {
  it('offers all four tabs in registry order to a complete reader', () => {
    const tabs = buildSubmissionTabs('en', 19, new Set(COMPLETE_RECORD_READER), en);
    expect(tabs.map((tab) => tab.id)).toEqual([...ALL_TAB_IDS]);
  });

  it('builds every tab href with the frozen builder and the record id', () => {
    const tabs = buildSubmissionTabs('th', 19, new Set(COMPLETE_RECORD_READER), en);
    expect(tabs.map((tab) => tab.href)).toEqual([
      '/th/evaluation/submissions/19/summary',
      '/th/evaluation/submissions/19/results',
      '/th/evaluation/submissions/19/logs',
      '/th/evaluation/submissions/19/evaluation',
    ]);
  });

  it.each([
    ['file:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation']],
    ['submissionresult:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.evaluation']],
    ['evaluation:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs']],
  ])('offers no link for the tab that loses %s', (missingKey, expectedIds) => {
    const partialKeys = COMPLETE_RECORD_READER.filter((key) => key !== missingKey);
    const tabs = buildSubmissionTabs('en', 19, new Set(partialKeys), en);
    expect(tabs.map((tab) => tab.id)).toEqual(expectedIds);
  });

  it('conceals the whole rail from a caller without submission:read', () => {
    expect(() => buildSubmissionTabs('en', 19, new Set(['submissionresult:read', 'file:read', 'evaluation:read']), en))
      .toThrow('NEXT_NOT_FOUND');
  });
});

describe('Submission record landing', () => {
  it('conceals a malformed record id', async () => {
    grant(COMPLETE_RECORD_READER);
    await expect(SubmissionLandingPage({ params: Promise.resolve({ locale: 'en', id: '19abc' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('conceals the record from a caller without submission:read', async () => {
    grant(['submissionresult:read', 'file:read', 'evaluation:read']);
    await expect(SubmissionLandingPage({ params: Promise.resolve({ locale: 'en', id: '19' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends a permitted caller to the default Summary child through the manifest', async () => {
    grant(COMPLETE_RECORD_READER);
    await expect(SubmissionLandingPage({ params: Promise.resolve({ locale: 'th', id: '19' }) }))
      .rejects.toThrow('NEXT_REDIRECT:/th/evaluation/submissions/19/summary');
  });
});
