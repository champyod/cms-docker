import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/lib/dictionary';
import SubmissionRecordLayout, { buildSubmissionTabs, submissionDescription, submissionHeading, submissionStatus } from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/layout';
import type { SubmissionStatusLabels } from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/layout';
import SubmissionLandingPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/page';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { getPreviousSubmission, getSubmissionSummary } from '@/lib/evaluation-read-models';
import { getSubmissionJudgingState } from '@/lib/evaluation-read-model-judging-state';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); }),
  usePathname: () => '/en/evaluation/submissions/19/summary',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
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
  getPreviousSubmission: vi.fn(),
}));

vi.mock('@/lib/evaluation-read-model-judging-state', () => ({
  getSubmissionJudgingState: vi.fn(),
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => en) }));

// Why the dictionary is handed over without its provider: the record header now carries the live
// indicator, whose copy comes from the same dictionary the layout's page supplies in the browser.
vi.mock('@/hooks/useDictionary', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDictionary')>('@/hooks/useDictionary');
  const dictionary = await vi.importActual<{ default: Dictionary }>('@/dictionaries/en.json');
  return { ...actual, useDictionary: () => dictionary.default };
});

const RECORD_DIR = 'src/app/[locale]/(authenticated)/evaluation/submissions/[id]';

const CANONICAL_RECORD_PATHS = [
  `${RECORD_DIR}/layout.tsx`,
  `${RECORD_DIR}/page.tsx`,
  `${RECORD_DIR}/not-found.tsx`,
  `${RECORD_DIR}/header-links.tsx`,
  `${RECORD_DIR}/summary/loading.tsx`,
  `${RECORD_DIR}/summary/page.tsx`,
  `${RECORD_DIR}/results/loading.tsx`,
  `${RECORD_DIR}/results/page.tsx`,
  `${RECORD_DIR}/logs/loading.tsx`,
  `${RECORD_DIR}/logs/page.tsx`,
  `${RECORD_DIR}/evaluation/loading.tsx`,
  `${RECORD_DIR}/evaluation/page.tsx`,
  `${RECORD_DIR}/history/loading.tsx`,
  `${RECORD_DIR}/history/error.tsx`,
  `${RECORD_DIR}/history/page.tsx`,
  'src/components/submissions/SubmissionSummaryTab.tsx',
  'src/components/submissions/SubmissionSourceViewer.tsx',
  'src/components/submissions/SubmissionResultsTab.tsx',
  'src/components/submissions/SubmissionLogsTab.tsx',
  'src/components/submissions/SubmissionEvaluationTab.tsx',
  'src/components/submissions/SubmissionActionBar.tsx',
  'src/components/submissions/SubmissionCommentDialog.tsx',
  'src/components/submissions/SubmissionFileActions.tsx',
  'src/components/submissions/SubmissionRerunMenu.tsx',
  'src/components/submissions/SubmissionRecomputeDialog.tsx',
  'src/components/submissions/SubmissionQueuedBanner.tsx',
  'src/components/submissions/SubmissionRecordLiveRefresh.tsx',
  'src/components/submissions/SubmissionHistoryTab.tsx',
  'src/components/submissions/submission-queue-store.ts',
  'src/components/submissions/MoveLaneDialog.tsx',
] as const;

const COMPLETE_RECORD_READER: readonly string[] = [
  'submission:read',
  'submissionresult:read',
  'file:read',
  'evaluation:read',
  'audit:read',
];

const ALL_TAB_IDS = [
  'evaluation.submission-tabs.summary',
  'evaluation.submission-tabs.results',
  'evaluation.submission-tabs.logs',
  'evaluation.submission-tabs.evaluation',
  'evaluation.submission-tabs.history',
] as const;

function grant(keys: readonly string[]): void {
  vi.mocked(requirePermission).mockImplementation(async (permission: string) => {
    if (!keys.includes(permission)) throw new AuthorizationError(403);
    return new Set(keys);
  });
}

describe('canonical Submission record routes', () => {
  it('fails until the record route, its five tab routes, and the tab components exist', () => {
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

  it('enables the Submission record landing and its five tabs as physical registry routes', () => {
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
      'evaluation.submission-tabs.history',
    ]);
  });

  it('keeps query-string tab selection out of every Submission record file', () => {
    for (const path of CANONICAL_RECORD_PATHS.filter((entry) => entry.startsWith(RECORD_DIR))) {
      expect(readFileSync(join(process.cwd(), path), 'utf8'), path).not.toContain('?tab=');
    }
  });
});

describe('Submission record tab rail', () => {
  it('offers all five tabs in registry order to a complete reader', () => {
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
      '/th/evaluation/submissions/19/history',
    ]);
  });

  it.each([
    ['file:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation', 'evaluation.submission-tabs.history']],
    ['submissionresult:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.evaluation', 'evaluation.submission-tabs.history']],
    ['evaluation:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.history']],
    ['audit:read', ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation']],
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

let recordHtml = '';

beforeAll(async () => {
  grant(COMPLETE_RECORD_READER);
  vi.mocked(getSubmissionSummary).mockResolvedValue({
    id: 19,
    timestamp: '2026-02-03T04:05:06.000Z',
    language: 'cpp',
    comment: '',
    official: false,
    user: null,
    contest: null,
    task: null,
    capabilities: {
      canUpdate: true,
      canRecompute: true,
      canDownload: true,
      canMoveLane: true,
    },
  });
  vi.mocked(getSubmissionJudgingState).mockResolvedValue({ phase: 'done', totalScore: 100 });
  vi.mocked(getPreviousSubmission).mockResolvedValue(null);
  const element = await SubmissionRecordLayout({
    children: createElement('div', null, 'Record body'),
    params: Promise.resolve({ locale: 'en', id: '19' }),
  });
  recordHtml = renderToStaticMarkup(element);
});

function breadcrumbHrefs(html: string): string[] {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  return [...nav.matchAll(/<a[^>]*href="([^"]*)"/g)].map((match) => match[1]);
}

describe('Submission record breadcrumbs', () => {
  it('closes the trail on the submissions list the record lives under', () => {
    // Why Home and the list are the two links: the group is a section with no page
    // of its own, while the submissions list is the record's real parent and the
    // reader's way back up out of the record.
    expect(breadcrumbHrefs(recordHtml)).toEqual(['/en', '/en/evaluation/submissions']);
  });

  it('never points two crumbs at one URL', () => {
    const hrefs = breadcrumbHrefs(recordHtml);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('never points a crumb at the submission record itself', () => {
    expect(breadcrumbHrefs(recordHtml)).not.toContain('/en/evaluation/submissions/19');
  });

  it('names the group and the list page without repeating the record heading', () => {
    const nav = recordHtml.slice(recordHtml.indexOf('<nav'), recordHtml.indexOf('</nav>'));

    expect(nav).toContain('Evaluation');
    expect(nav).toContain('Submissions');
  });

  it('heads the record with its id rather than a generic entity label', () => {
    const heading = recordHtml.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] ?? '';

    expect(heading).toBe('#19');
    expect(heading).not.toContain('Submission');
  });
});

describe('Submission record header identity', () => {
  const BASE: SubmissionSummary = {
    id: 19,
    timestamp: '2026-02-03T04:05:06.000Z',
    language: 'cpp',
    comment: '',
    official: false,
    user: { id: 5, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
    contest: { id: 2, name: 'ICPC 2026' },
    task: { id: 8, name: 'aplusb', title: 'A Plus B' },
    capabilities: {
      canUpdate: true,
      canRecompute: true,
      canDownload: true,
      canMoveLane: true,
    },
  };

  it('heads the record with the task it was sent for and names the submitter below', () => {
    expect(submissionHeading(BASE)).toBe('aplusb');
    expect(submissionDescription(BASE)).toBe('Ada Lovelace · ada');
  });

  it('leads with the full name and keeps the handle behind it', () => {
    const onlyFirst = { ...BASE, user: { id: 5, username: 'ada', firstName: 'Ada', lastName: null } };
    expect(submissionDescription(onlyFirst)).toBe('Ada · ada');
  });

  it('falls back to the username when the name columns are denied or empty', () => {
    const anonymous = { ...BASE, user: { id: 5, username: 'ada', firstName: null, lastName: null } };
    const nameless = { ...BASE, user: { id: 5, username: 'ada', firstName: '', lastName: '' } };

    expect(submissionDescription(anonymous)).toBe('ada');
    expect(submissionDescription(nameless)).toBe('ada');
  });

  it('falls back to the id and the language when the task is hidden from this reader', () => {
    const taskless = { ...BASE, task: null };

    expect(submissionHeading(taskless)).toBe('#19');
    expect(submissionDescription(taskless)).toBe('Ada Lovelace · ada');
  });

  it('falls back to the language when the submitter is hidden from this reader', () => {
    expect(submissionDescription({ ...BASE, user: null })).toBe('cpp');
    expect(submissionDescription({ ...BASE, user: null, language: null })).toBeNull();
  });

  it('never repeats the heading as its own description', () => {
    const cases: SubmissionSummary[] = [
      BASE,
      { ...BASE, task: null },
      { ...BASE, task: null, user: null },
      { ...BASE, task: null, user: null, language: null },
    ];

    for (const summary of cases) {
      const heading = submissionHeading(summary);
      expect(heading.trim(), JSON.stringify(summary)).not.toBe('');
      expect(submissionDescription(summary), heading).not.toBe(heading);
    }
  });
});

describe('Submission record status pill', () => {
  const LABELS: SubmissionStatusLabels = {
    judging: 'Judging…',
    compiling: 'Compiling',
    compilationFailed: 'Compilation Failed',
    evaluating: 'Evaluating',
    scoring: 'Scoring',
    done: 'Done',
    official: '★ Official',
    points: '{score} pts',
  };

  it('states score, judging phase, and the official flag as one info pill', () => {
    expect(submissionStatus({ phase: 'done', totalScore: 100 }, true, LABELS))
      .toEqual({ kind: 'info', title: '100.0 pts · Done · ★ Official' });
  });

  it('shows Judging… when a requeue has cleared every result row', () => {
    expect(submissionStatus({ phase: 'judging', totalScore: null }, false, LABELS))
      .toEqual({ kind: 'info', title: 'Judging…' });
  });

  it.each([
    ['compiling', 'Compiling'],
    ['compilation-failed', 'Compilation Failed'],
    ['evaluating', 'Evaluating'],
    ['scoring', 'Scoring'],
  ] as const)('derives the %s phase exactly like the Results tab', (phase, title) => {
    expect(submissionStatus({ phase, totalScore: null }, false, LABELS))
      .toEqual({ kind: 'info', title });
  });

  it('withholds the score segment while any dataset is unscored', () => {
    expect(submissionStatus({ phase: 'scoring', totalScore: null }, false, LABELS))
      .toEqual({ kind: 'info', title: 'Scoring' });
  });

  it('still states the official flag for a reader who may not read the outcome columns', () => {
    expect(submissionStatus(null, true, LABELS)).toEqual({ kind: 'info', title: '★ Official' });
  });

  it('renders no status at all when there is nothing truthful to say', () => {
    expect(submissionStatus(null, false, LABELS)).toBeUndefined();
  });
});

describe('Submission record header composition', () => {
  const RELATIONED: SubmissionSummary = {
    id: 19,
    timestamp: '2026-02-03T04:05:06.000Z',
    language: 'cpp',
    comment: 'needs review',
    official: true,
    user: { id: 5, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
    contest: { id: 2, name: 'ICPC 2026' },
    task: { id: 8, name: 'aplusb', title: 'A Plus B' },
    capabilities: {
      canUpdate: true,
      canRecompute: true,
      canDownload: true,
      canMoveLane: true,
    },
  };

  let composedHtml = '';

  beforeAll(async () => {
    grant([...COMPLETE_RECORD_READER, 'submission:list']);
    vi.mocked(getSubmissionSummary).mockResolvedValue(RELATIONED);
    vi.mocked(getSubmissionJudgingState).mockResolvedValue({ phase: 'done', totalScore: 100 });
    vi.mocked(getPreviousSubmission).mockResolvedValue({
      submissionId: 7,
      timestamp: '2026-01-01T00:00:00.000Z',
      source: null,
    });
    const element = await SubmissionRecordLayout({
      children: createElement('div', null, 'Record body'),
      params: Promise.resolve({ locale: 'en', id: '19' }),
    });
    composedHtml = renderToStaticMarkup(element);
  });

  it('passes the judging state as an info status instead of a blocking one', () => {
    expect(composedHtml).toContain('100.0 pts · Done · ★ Official');
    expect(composedHtml).toContain('Record body');
  });

  it('hoists one record-level toolbar named after the submission', () => {
    expect(composedHtml).toContain('role="toolbar"');
    expect(composedHtml).toContain('aria-label="Submission #19 actions"');
    expect(composedHtml.match(/role="toolbar"/g)).toHaveLength(1);
  });

  it('leads the description with the full name ahead of the handle', () => {
    expect(composedHtml).toContain('Ada Lovelace · ada');
  });

  it('links the previous submission chip to the compare section of the summary', () => {
    expect(composedHtml).toContain(
      'href="/en/evaluation/submissions/19/summary#submission-compare"',
    );
    expect(composedHtml).toContain('Compare with #7');
  });

  it('keeps every entity record link beside its filtered-list affordance', () => {
    const list = buildRoute('en', 'evaluation.submissions');
    expect(composedHtml).toContain(`href="${buildRoute('en', 'people.user-record', { id: 5 })}"`);
    expect(composedHtml).toContain(`href="${buildRoute('en', 'tasks.record', { id: 8 })}"`);
    expect(composedHtml).toContain(`href="${buildRoute('en', 'contests.record', { id: 2 })}"`);
    expect(composedHtml).toContain(`href="${list}?user=5"`);
    expect(composedHtml).toContain(`href="${list}?task=8"`);
    expect(composedHtml).toContain(`href="${list}?contest=2"`);
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
