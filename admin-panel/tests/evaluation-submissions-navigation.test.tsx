// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { buildRoute } from '@/lib/navigation/routes';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import type { SubmissionListItem } from '@/types';

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; without it, later row queries
// would bind to the accumulated document.body.
afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/evaluation/submissions',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPush = vi.fn();

const SUBMISSION_ROW = {
  id: 19,
  timestamp: new Date('2026-02-03T04:05:06.000Z'),
  language: 'cpp',
  comment: '',
  official: false,
  tasks: { id: 3, name: 'sum', title: 'Sum' },
  participations: {
    users: { username: 'ada' },
    contests: { name: 'Thailand Cup' },
  },
  submission_results: [
    {
      score: 80,
      dataset_id: 1,
      compilation_outcome: 'ok',
      evaluation_outcome: 'ok',
      compilation_time: 12,
      compilation_memory: null,
      compilation_text: [],
      compilation_stdout: null,
      compilation_stderr: null,
    },
  ],
  files: [],
} as unknown as SubmissionListItem;

const RECORD_HREF = buildRoute('en', 'evaluation.submission-record', { id: SUBMISSION_ROW.id });

function renderList(totalPages = 1): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionList
        initialSubmissions={[SUBMISSION_ROW]}
        totalPages={totalPages}
        currentPage={1}
        navigation={en.navigation}
      />
    </DictionaryProvider>,
  );
  return container;
}

function recordAnchors(container: HTMLElement): HTMLAnchorElement[] {
  return [...container.querySelectorAll('a')].filter(
    (anchor) => anchor.getAttribute('href') === RECORD_HREF,
  );
}

describe('submission list canonical navigation', () => {
  it('routes a desktop row click to the record built with the frozen builder', () => {
    mockPush.mockClear();
    const container = renderList();

    const cell = container.querySelector('tbody tr td:nth-child(3)');
    if (!cell) throw new Error('Missing desktop submission row');
    fireEvent.click(cell);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(RECORD_HREF);
  });

  it('routes a desktop row Enter press to the same record', () => {
    mockPush.mockClear();
    const container = renderList();

    const row = container.querySelector('tbody tr');
    if (!row) throw new Error('Missing desktop submission row');
    fireEvent.keyDown(row, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(RECORD_HREF);
  });

  it('exposes the canonical record as a real link in the desktop and mobile layouts', () => {
    const container = renderList();

    const anchors = recordAnchors(container);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].getAttribute('href')).toBe('/en/evaluation/submissions/19');
    expect(container.querySelector('.space-y-3.md\\:hidden a')?.getAttribute('href')).toBe(RECORD_HREF);
  });

  it('keeps the row action from double-navigating through the row handler', () => {
    mockPush.mockClear();
    const container = renderList();

    const [desktopAction] = recordAnchors(container);
    if (!desktopAction) throw new Error('Missing desktop record action');
    fireEvent.click(desktopAction);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens no submission dialog and keeps list pagination on the canonical route', () => {
    mockPush.mockClear();
    const container = renderList(2);

    expect(document.body.textContent).not.toContain('Recompute');
    expect(container.querySelector('tbody tr')).toBeTruthy();

    const next = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Next');
    if (!next) throw new Error('Missing pagination control');
    fireEvent.click(next);

    expect(mockPush.mock.calls[0][0]).toContain('page=2');
  });
});
