// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import type { SubmissionListItem } from '@/types';

// Why: globals are disabled in vitest.config.ts, so the automatic afterEach cleanup
// does not run, and the selection store lives in sessionStorage — both must be reset
// between cases or the next test would inherit the previous one's checks.
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

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

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

const PREVIEW = { matched: 2, willProcess: 2, capped: false, limit: 200 };
const EMPTY_REPORT = { processed: 0, succeeded: 0, failed: 0, capped: false, outcomes: [] };
const SCOPE_PREVIEW = { matched: 4, willProcess: 4, capped: false, limit: 200 };

beforeEach(() => {
  mocks.previewBatchRecalculation.mockResolvedValue(SCOPE_PREVIEW);
  mocks.previewRecalculationByIds.mockResolvedValue(PREVIEW);
  mocks.recalculateSubmissionIds.mockResolvedValue(EMPTY_REPORT);
  mocks.recalculateSubmissions.mockResolvedValue(EMPTY_REPORT);
  mocks.recalculateSubmission.mockResolvedValue({ success: true });
  mocks.toggleSubmissionOfficial.mockResolvedValue({ success: true });
  mocks.setSubmissionOfficial.mockResolvedValue({ success: true, updated: 0 });
});

function submissionRow(id: number): SubmissionListItem {
  return {
    id,
    timestamp: new Date('2026-02-03T04:05:06.000Z'),
    language: 'cpp',
    comment: '',
    official: false,
    tasks: { id: 3, name: 'sum', title: 'Sum' },
    participations: { users: { username: `user${id}` }, contests: { name: 'Thailand Cup' } },
    submission_results: [],
    files: [],
  } as unknown as SubmissionListItem;
}

function renderList(): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionList
        initialSubmissions={[11, 12, 13, 14].map(submissionRow)}
        totalPages={1}
        currentPage={1}
        navigation={en.navigation}
        canRecalculate
        canOfficial
      />
    </DictionaryProvider>,
  );
  return container;
}

function checkbox(id: number): HTMLInputElement {
  return screen.getByLabelText(`Select submission ${id}`) as HTMLInputElement;
}

function checkedIds(): boolean[] {
  return [11, 12, 13, 14].map((id) => checkbox(id).checked);
}

describe('submission list selection', () => {
  it('selects a row from its checkbox without opening the record', () => {
    mockPush.mockClear();
    renderList();

    fireEvent.click(checkbox(12));

    expect(checkbox(12).checked).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('still opens the record from the row itself', () => {
    mockPush.mockClear();
    const container = renderList();

    const cell = container.querySelector('tbody tr td:nth-child(4)');
    if (!cell) throw new Error('Missing desktop submission cell');
    fireEvent.click(cell);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toContain('/submissions/11');
  });

  it('shows the bulk bar with its count and actions once a row is checked', () => {
    renderList();

    fireEvent.click(checkbox(11));
    fireEvent.click(checkbox(13));

    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rescore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy();
  });

  it('clears the selection from the bulk bar', () => {
    renderList();

    fireEvent.click(checkbox(11));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(checkbox(11).checked).toBe(false);
  });

  it('extends a shift-click from the anchor across the range', () => {
    renderList();

    fireEvent.click(checkbox(11));
    fireEvent.pointerDown(checkbox(14), { shiftKey: true });
    fireEvent.click(checkbox(14), { shiftKey: true });

    expect(checkedIds()).toEqual([true, true, true, true]);
    expect(screen.getByText('4 selected')).toBeTruthy();
  });

  it('toggles a shift-range to the deselected anchor state', () => {
    renderList();

    fireEvent.click(checkbox(11));
    fireEvent.click(checkbox(11));
    fireEvent.pointerDown(checkbox(13), { shiftKey: true });
    fireEvent.click(checkbox(13), { shiftKey: true });

    expect(checkedIds()).toEqual([false, false, false, false]);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('falls back to a plain toggle when no anchor exists yet', () => {
    renderList();

    fireEvent.pointerDown(checkbox(13), { shiftKey: true });
    fireEvent.click(checkbox(13), { shiftKey: true });

    expect(checkedIds()).toEqual([false, false, true, false]);
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('keeps select-all additive for the header box', () => {
    renderList();

    fireEvent.click(screen.getByLabelText('Select all submissions'));

    expect(checkedIds()).toEqual([true, true, true, true]);
  });
});

describe('submission bulk requeue', () => {
  it('previews the selection, demands a reason, then runs with it', async () => {
    mocks.previewRecalculationByIds.mockResolvedValue(PREVIEW);
    mocks.recalculateSubmissionIds.mockResolvedValue({ ...EMPTY_REPORT, processed: 2, succeeded: 2 });
    renderList();

    fireEvent.click(checkbox(11));
    fireEvent.click(checkbox(12));
    fireEvent.click(screen.getByRole('button', { name: 'Rescore' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Recalculate this submission (score)?');
    expect(dialog.textContent).toContain('This runs on the 2 selected submission(s).');

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    expect(await screen.findByText('A reason is required')).toBeTruthy();
    expect(mocks.recalculateSubmissionIds).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 're-run after a checker fix' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));

    await waitFor(() =>
      expect(mocks.recalculateSubmissionIds).toHaveBeenCalledWith(
        [11, 12],
        'score',
        { reason: 're-run after a checker fix' },
      ),
    );
  });
});
