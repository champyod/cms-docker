// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ApplyToTargetsDialog, type TargetKind } from '@/components/core/ApplyToTargetsDialog';
import type { TargetOption } from '@/components/core/TargetMultiSelect';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/apiClient', () => ({
  apiClient: { post: mocks.post, get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const CONTESTS: TargetOption[] = [
  { id: 7, label: 'Alpha' },
  { id: 1, label: 'Beta' },
  { id: 2, label: 'Gamma' },
];
const TASKS: TargetOption[] = [
  { id: 9, label: 'sum' },
  { id: 4, label: 'diff' },
];

type DialogProps = Partial<React.ComponentProps<typeof ApplyToTargetsDialog>>;

function renderDialog(props: DialogProps): void {
  const loadTargets = props.loadTargets ?? (async (kind: TargetKind): Promise<TargetOption[]> => (kind === 'contest' ? CONTESTS : TASKS));
  render(
    <DictionaryProvider dict={en}>
      <ApplyToTargetsDialog
        isOpen
        onClose={vi.fn()}
        kinds={['contest']}
        patch={{ max_submission_number: 5 }}
        loadTargets={loadTargets}
        {...props}
      />
    </DictionaryProvider>,
  );
}

function countText(): string | null {
  return screen.getByTestId('apply-targets-count').textContent;
}

function applyButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.post.mockResolvedValue({ success: true, updatedCount: 1, failed: [] });
});

describe('ApplyToTargetsDialog target picking', () => {
  it('narrows the list as the operator searches and says so when nothing matches', async () => {
    renderDialog({ preselected: { contest: [7] } });
    await screen.findByRole('checkbox', { name: 'Alpha' });

    fireEvent.change(screen.getByLabelText('Search contests'), { target: { value: 'bet' } });
    expect(screen.queryByRole('checkbox', { name: 'Alpha' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Beta' })).not.toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Gamma' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Search contests'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).not.toBeNull();
  });

  it('selects every target, counts them live and posts exactly what was checked', async () => {
    renderDialog({ preselected: { contest: [7] } });
    await screen.findByRole('checkbox', { name: 'Alpha' });

    expect(countText()).toBe('1 selected');
    expect(applyButton('Apply to 1 selected')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Select all'));
    expect(countText()).toBe('3 selected');
    expect(applyButton('Apply to 3 selected')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Gamma' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(applyButton('Apply to 3 selected'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/contests/batch', {
        action: 'update-limits',
        contestIds: [7, 1, 2],
        patch: { max_submission_number: 5 },
      }),
    );
  });

  it('clears the selection again so a mis-pick does not travel with the write', async () => {
    renderDialog({ preselected: { contest: [7, 1] } });
    await screen.findByRole('checkbox', { name: 'Alpha' });
    expect(countText()).toBe('2 selected');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(countText()).toBe('0 selected');

    fireEvent.click(applyButton('Apply to 0 selected'));
    await waitFor(() => expect(screen.getByText('Choose at least one target.')).toBeTruthy());
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('posts to both endpoints when both kinds are in play, and counts them together', async () => {
    renderDialog({ kinds: ['contest', 'task'], preselected: { contest: [7], task: [9] } });
    await screen.findByRole('checkbox', { name: 'sum' });
    expect(countText()).toBe('2 selected');

    fireEvent.click(applyButton('Apply to 2 selected'));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/api/contests/batch', {
      action: 'update-limits',
      contestIds: [7],
      patch: { max_submission_number: 5 },
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/api/tasks/batch', {
      action: 'update-limits',
      taskIds: [9],
      patch: { max_submission_number: 5 },
    });
  });

  it('sends nothing at all until a limit was set or cleared', async () => {
    renderDialog({ preselected: { contest: [7] }, initiallyTouched: false });
    await screen.findByRole('checkbox', { name: 'Alpha' });

    fireEvent.click(applyButton('Apply to 1 selected'));
    await waitFor(() => expect(screen.getByText('Set or clear at least one limit.')).toBeTruthy());
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('keeps the successes and names the targets that refused', async () => {
    mocks.post.mockResolvedValue({ success: true, updatedCount: 1, failed: [{ id: 9, reason: 'Task not found' }] });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderDialog({ kinds: ['task'], preselected: { task: [9] }, onClose, onSuccess });
    await screen.findByRole('checkbox', { name: 'sum' });

    fireEvent.click(applyButton('Apply to 1 selected'));
    await waitFor(() => expect(screen.getByText('Applied to 1; these failed: 9')).toBeTruthy());
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes and refreshes once every target took the write', async () => {
    mocks.post.mockResolvedValue({ success: true, updatedCount: 2, failed: [] });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderDialog({ kinds: ['task'], preselected: { task: [9, 4] }, onClose, onSuccess });
    await screen.findByRole('checkbox', { name: 'sum' });

    fireEvent.click(applyButton('Apply to 2 selected'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/these failed/)).toBeNull();
  });
});
