// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { REQUEUE_WATCH_KEY } from '@/components/submissions/SubmissionRequeueToasts';
import type { SubmissionListItem } from '@/types';

// Why: globals are disabled in vitest.config.ts, so cleanup is manual, and the watch list
// lives in sessionStorage — both must be reset between cases.
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/evaluation/submissions',
  useSearchParams: () => new URLSearchParams(),
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: toasts }));

const mocks = vi.hoisted(() => ({
  previewBatchRecalculation: vi.fn(),
  previewRecalculationByIds: vi.fn(),
  recalculateSubmissionIds: vi.fn(),
  recalculateSubmissions: vi.fn(),
  recalculateSubmission: vi.fn(),
  toggleSubmissionOfficial: vi.fn(),
  setSubmissionOfficial: vi.fn(),
}));

vi.mock('@/app/actions/submissions', () => ({
  previewBatchRecalculation: mocks.previewBatchRecalculation,
  previewRecalculationByIds: mocks.previewRecalculationByIds,
  recalculateSubmissionIds: mocks.recalculateSubmissionIds,
  recalculateSubmissions: mocks.recalculateSubmissions,
  recalculateSubmission: mocks.recalculateSubmission,
  toggleSubmissionOfficial: mocks.toggleSubmissionOfficial,
  setSubmissionOfficial: mocks.setSubmissionOfficial,
}));

type Outcome = { score: number | null; compilation_outcome: string | null; evaluation_outcome: string | null };

function row(id: number, outcome: Outcome): SubmissionListItem {
  return {
    id,
    timestamp: new Date('2026-02-03T04:05:06.000Z'),
    language: 'cpp',
    comment: '',
    official: false,
    tasks: { id: 3, name: 'sum', title: 'Sum' },
    participations: { users: { username: 'user' + id }, contests: { name: 'Thailand Cup' } },
    submission_results: [outcome],
    files: [],
  } as unknown as SubmissionListItem;
}

const SCORED: Outcome = { score: 80, compilation_outcome: 'ok', evaluation_outcome: 'ok' };
const COMPILATION_FAILED: Outcome = { score: null, compilation_outcome: 'fail', evaluation_outcome: null };
const RUNNING: Outcome = { score: null, compilation_outcome: null, evaluation_outcome: null };

function seedWatch(ids: readonly number[]): void {
  window.sessionStorage.setItem(
    REQUEUE_WATCH_KEY,
    JSON.stringify(ids.map((id) => ({ id, queuedAt: Date.now() }))),
  );
}

function readWatch(): readonly number[] {
  const raw = window.sessionStorage.getItem(REQUEUE_WATCH_KEY);
  if (raw === null) return [];
  return (JSON.parse(raw) as { id: number }[]).map((entry) => entry.id);
}

function renderRows(rows: readonly SubmissionListItem[], canRecalculate = false): void {
  render(
    <DictionaryProvider dict={en}>
      <SubmissionList
        initialSubmissions={rows}
        totalPages={1}
        currentPage={1}
        navigation={en.navigation}
        canRecalculate={canRecalculate}
      />
    </DictionaryProvider>,
  );
}

function toastLines(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewBatchRecalculation.mockResolvedValue({ matched: 0, willProcess: 0, capped: false, limit: 200 });
  mocks.previewRecalculationByIds.mockResolvedValue({ matched: 0, willProcess: 0, capped: false, limit: 200 });
  mocks.recalculateSubmission.mockResolvedValue({ success: true });
});

describe('requeue completion toasts', () => {
  it('announces a watched submission that reaches a score, once', () => {
    seedWatch([11, 15]);
    renderRows([row(11, SCORED), row(12, RUNNING)]);

    const lines = toastLines(toasts.success);
    expect(lines.some((line) => line.includes('#11') && line.includes('80'))).toBe(true);
    expect(readWatch()).toEqual([15]);
  });

  it('warns when a watched submission fails to compile', () => {
    seedWatch([12]);
    renderRows([row(12, COMPILATION_FAILED)]);

    const lines = toastLines(toasts.warning);
    expect(lines.some((line) => line.includes('#12') && line.includes('compilation failed'))).toBe(true);
    expect(readWatch()).toEqual([]);
  });

  it('leaves a still-running watched submission watched and silent', () => {
    seedWatch([14]);
    renderRows([row(14, RUNNING)]);

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(readWatch()).toEqual([14]);
  });

  it('collapses several completions into one summary toast', () => {
    seedWatch([11, 12, 13]);
    renderRows([row(11, SCORED), row(12, SCORED), row(13, COMPILATION_FAILED)]);

    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(String(toasts.success.mock.calls[0][0])).toBe('Submission recalculations finished');
    const description = String((toasts.success.mock.calls[0][1] as { description?: string }).description);
    expect(description).toContain('#11');
    expect(description).toContain('+2 more');
    expect(readWatch()).toEqual([]);
  });

  it('says nothing when nothing watched has finished', () => {
    renderRows([row(21, SCORED), row(22, COMPILATION_FAILED)]);

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it('watches the submission a row rejudge requeued', async () => {
    renderRows([row(12, RUNNING)], true);

    const [rejudge] = screen.getAllByLabelText('Rejudge submission 12');
    if (!rejudge) throw new Error('Missing rejudge action');
    fireEvent.click(rejudge);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'checker was fixed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recalculate' }));

    await waitFor(() => expect(readWatch()).toContain(12));
    expect(mocks.recalculateSubmission).toHaveBeenCalledWith(12, 'score', { reason: 'checker was fixed' });
    expect(toastLines(toasts.success).some((line) => line.includes('finished'))).toBe(false);
  });
});
