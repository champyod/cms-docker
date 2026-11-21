// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetScoreParamsEditor } from '@/components/tasks/DatasetScoreParamsEditor';

afterEach(cleanup);

const TESTCASES = ['subtask1_01', 'subtask1_02', 'subtask2_01'];

interface EditorHandles {
  onParamsChange: ReturnType<typeof vi.fn>;
  onLintError: ReturnType<typeof vi.fn>;
}

function renderEditor(params: unknown, scoreType = 'GroupMin', testcases: readonly string[] = TESTCASES): EditorHandles {
  const onParamsChange = vi.fn();
  const onLintError = vi.fn();
  render(
    <DatasetScoreParamsEditor
      scoreType={scoreType}
      params={params}
      testcases={testcases}
      onParamsChange={onParamsChange}
      onLintError={onLintError}
    />,
  );
  return { onParamsChange, onLintError };
}

function moveSelect(codename: string): HTMLSelectElement {
  return screen.getByLabelText(`Move ${codename} to another subtask`) as HTMLSelectElement;
}

describe('DatasetScoreParamsEditor board view', () => {
  it('renders the board by default for grouped score types', () => {
    renderEditor([[40, 'subtask1_.*'], [60, 'subtask2_.*']]);
    expect(screen.getAllByText('Subtask 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Subtask 2').length).toBeGreaterThan(0);
    expect(screen.getByText('subtask1_01')).toBeTruthy();
  });

  it('falls back to rows for the Sum score type', () => {
    renderEditor(100, 'Sum');
    expect(screen.queryByText('Subtask 1')).toBeNull();
    expect(screen.getByPlaceholderText('e.g. 100')).toBeTruthy();
  });

  it('hides the board until the dataset has testcases', () => {
    renderEditor([[40, 'subtask1_.*']], 'GroupMin', []);
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
  });

  it('moves a testcase between subtasks through the move-to field', () => {
    const { onParamsChange } = renderEditor([[40, 'subtask1_.*'], [60, 'subtask2_.*']]);
    fireEvent.change(moveSelect('subtask1_02'), { target: { value: 'subtask-1' } });
    expect(onParamsChange).toHaveBeenCalledWith([
      [40, '^(?:subtask1_01)$'],
      [60, '^(?:subtask1_02|subtask2_01)$'],
    ]);
  });

  it('falls back to an alternation when a move mixes prefixes', () => {
    const { onParamsChange } = renderEditor([[40, 'subtask1_.*'], [60, 'subtask2_.*']]);
    fireEvent.change(moveSelect('subtask2_01'), { target: { value: 'subtask-0' } });
    expect(onParamsChange).toHaveBeenCalledWith([
      [40, '^(?:subtask1_01|subtask1_02|subtask2_01)$'],
      [60, ''],
    ]);
  });

  it('still edits rows directly', () => {
    const { onParamsChange } = renderEditor([[40, 'subtask1_.*'], [60, 'subtask2_.*']]);
    fireEvent.click(screen.getByRole('button', { name: 'Rows' }));
    const input = screen.getAllByPlaceholderText('3 or subtask1_.*')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'subtask2_.*' } });
    expect(onParamsChange).toHaveBeenCalledWith([[40, 'subtask2_.*'], [60, 'subtask2_.*']]);
  });
});
