// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DatasetTaskTypeParamsEditor } from '@/components/tasks/DatasetTaskTypeParamsEditor';

afterEach(cleanup);

const CODE_PLACEHOLDER = 'e.g. ["alone", ["input.txt", "output.txt"], "diff"]';
const NOOP = (): void => undefined;

interface EditorHandles {
  onParamsChange: ReturnType<typeof vi.fn>;
  onLintError: ReturnType<typeof vi.fn>;
}

function renderEditor(taskType: string, params: unknown = []): EditorHandles {
  const onParamsChange = vi.fn();
  const onLintError = vi.fn();
  render(
    <DatasetTaskTypeParamsEditor
      taskType={taskType}
      params={params}
      onParamsChange={onParamsChange}
      onLintError={onLintError}
    />,
  );
  return { onParamsChange, onLintError };
}

/** Stands in for the form, which is what keeps a list the editor accepts. */
function Harness({ params }: { params: unknown }): React.JSX.Element {
  const [stored, setStored] = useState<unknown>(params);
  return <DatasetTaskTypeParamsEditor taskType="Batch" params={stored} onParamsChange={setStored} onLintError={NOOP} />;
}

function openJson(): void {
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
}

function openVisual(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Visual' }));
}

function codeBox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(CODE_PLACEHOLDER) as HTMLTextAreaElement;
}

function control(label: string): HTMLInputElement | HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
}

const FIELDS_BY_TYPE = [
  { taskType: 'Batch', labels: ['Compilation', 'Input file', 'Output file', 'Output evaluation'] },
  { taskType: 'OutputOnly', labels: ['Output evaluation'] },
  { taskType: 'TwoSteps', labels: ['Output evaluation'] },
  { taskType: 'Communication', labels: ['Number of processes', 'Compilation', 'User I/O'] },
];

const VALID_EDITS = [
  { taskType: 'Batch', label: 'Compilation', value: 'grader', params: ['grader', ['', ''], 'diff'] },
  { taskType: 'Batch', label: 'Input file', value: 'in.txt', params: ['alone', ['in.txt', ''], 'diff'] },
  { taskType: 'Batch', label: 'Output evaluation', value: 'comparator', params: ['alone', ['', ''], 'comparator'] },
  { taskType: 'OutputOnly', label: 'Output evaluation', value: 'comparator', params: ['comparator'] },
  { taskType: 'TwoSteps', label: 'Output evaluation', value: 'diff', params: ['diff'] },
  { taskType: 'Communication', label: 'Number of processes', value: '3', params: [3, 'alone', 'std_io'] },
  { taskType: 'Communication', label: 'Compilation', value: 'stub', params: [1, 'stub', 'std_io'] },
  { taskType: 'Communication', label: 'User I/O', value: 'fifo_io', params: [1, 'alone', 'fifo_io'] },
];

describe('the editor offers one control per parameter of the task type', () => {
  it.each(FIELDS_BY_TYPE)('$taskType offers $labels', ({ taskType, labels }) => {
    renderEditor(taskType);
    const controls = [
      ...screen.queryAllByRole('textbox'),
      ...screen.queryAllByRole('spinbutton'),
      ...screen.queryAllByRole('combobox'),
    ];
    expect(controls).toHaveLength(labels.length);
    for (const label of labels) expect(control(label)).not.toBeNull();
  });
});

describe('a visual edit emits the list the worker reads', () => {
  it.each(VALID_EDITS)('$taskType $label becomes $params', ({ taskType, label, value, params }) => {
    const { onParamsChange, onLintError } = renderEditor(taskType);
    fireEvent.change(control(label), { target: { value } });
    expect(onParamsChange).toHaveBeenCalledWith(params);
    expect(onLintError).toHaveBeenCalledWith('');
  });
});

describe('both views describe the same list', () => {
  const STORED = ['grader', ['in.txt', 'out.txt'], 'comparator'];
  const STORED_TEXT = JSON.stringify(STORED, null, 2);

  it('carries a stored list through JSON and back into the fields', () => {
    renderEditor('Batch', STORED);
    openJson();
    expect(codeBox().value).toBe(STORED_TEXT);
    openVisual();
    expect(control('Compilation').value).toBe('grader');
    expect(control('Input file').value).toBe('in.txt');
    expect(control('Output file').value).toBe('out.txt');
    expect(control('Output evaluation').value).toBe('comparator');
    openJson();
    expect(codeBox().value).toBe(STORED_TEXT);
  });

  it('shows the defaults of the task type in both views when nothing is stored', () => {
    renderEditor('Communication');
    openJson();
    expect(codeBox().value).toBe(JSON.stringify([1, 'alone', 'std_io'], null, 2));
    openVisual();
    expect(control('Number of processes').value).toBe('1');
    expect(control('User I/O').value).toBe('std_io');
  });

  it('reads an emptied JSON view as the defaults for the task type', () => {
    const { onParamsChange, onLintError } = renderEditor('Batch', STORED);
    openJson();
    fireEvent.change(codeBox(), { target: { value: '' } });
    expect(onParamsChange).toHaveBeenCalledWith(['alone', ['', ''], 'diff']);
    expect(onLintError).toHaveBeenCalledWith('');
  });
});

describe('a list the worker cannot read is refused with the reason', () => {
  it('names a choice outside the options and keeps the last accepted list', () => {
    const { onParamsChange, onLintError } = renderEditor('Batch', ['grader', ['', ''], 'diff']);
    openJson();
    fireEvent.change(codeBox(), { target: { value: '["stub", ["", ""], "diff"]' } });
    expect(onLintError).toHaveBeenLastCalledWith('Compilation must be one of: alone, grader.');
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('names a process count that is not an integer and stores nothing', () => {
    const { onParamsChange, onLintError } = renderEditor('Communication');
    fireEvent.change(control('Number of processes'), { target: { value: '1.5' } });
    expect(onLintError).toHaveBeenLastCalledWith('Number of processes must be an integer.');
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('rejects an object, then text that is not JSON at all', () => {
    const { onParamsChange, onLintError } = renderEditor('Batch');
    openJson();
    fireEvent.change(codeBox(), { target: { value: '{"output_eval": "diff"}' } });
    expect(onLintError).toHaveBeenLastCalledWith('Task type parameters must be a JSON array.');
    fireEvent.change(codeBox(), { target: { value: '["alone",' } });
    expect(onLintError).toHaveBeenLastCalledWith('Task type parameters must be valid JSON.');
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('completes a short list with the defaults instead of passing it on', () => {
    const { onParamsChange, onLintError } = renderEditor('Batch');
    openJson();
    fireEvent.change(codeBox(), { target: { value: '["grader"]' } });
    expect(onParamsChange).toHaveBeenCalledWith(['grader', ['', ''], 'diff']);
    expect(onLintError).toHaveBeenCalledWith('');
  });

  it('shows the completed list in the fields once the form keeps it', () => {
    render(<Harness params={null} />);
    openJson();
    fireEvent.change(codeBox(), { target: { value: '["grader"]' } });
    openVisual();
    expect(control('Compilation').value).toBe('grader');
    expect(control('Input file').value).toBe('');
    expect(control('Output file').value).toBe('');
  });
});

describe('a task type the panel does not know', () => {
  it('says so instead of offering fields it cannot verify', () => {
    renderEditor('Interactive', ['diff']);
    expect(screen.getByText('Unknown task type "Interactive".')).not.toBeNull();
    expect(screen.queryByLabelText('Output evaluation')).toBeNull();
  });
});

describe('a list that arrives from outside the editor', () => {
  it('re-reads the fields when another dataset is picked', () => {
    const onParamsChange = vi.fn();
    const onLintError = vi.fn();
    const editor = (params: unknown): React.JSX.Element => (
      <DatasetTaskTypeParamsEditor
        taskType="Batch"
        params={params}
        onParamsChange={onParamsChange}
        onLintError={onLintError}
      />
    );
    const { rerender } = render(editor(['grader', ['', ''], 'diff']));
    expect(control('Compilation').value).toBe('grader');
    rerender(editor(['alone', ['in.txt', 'out.txt'], 'comparator']));
    expect(control('Compilation').value).toBe('alone');
    expect(control('Input file').value).toBe('in.txt');
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('swaps the fields for the parameters of a new task type', () => {
    const onParamsChange = vi.fn();
    const onLintError = vi.fn();
    const editor = (taskType: string, params: unknown): React.JSX.Element => (
      <DatasetTaskTypeParamsEditor
        taskType={taskType}
        params={params}
        onParamsChange={onParamsChange}
        onLintError={onLintError}
      />
    );
    const { rerender } = render(editor('Batch', null));
    expect(control('Input file')).not.toBeNull();
    rerender(editor('Communication', [1, 'alone', 'std_io']));
    expect(control('Number of processes').value).toBe('1');
    expect(screen.queryByLabelText('Input file')).toBeNull();
  });
});

describe('a pasted field', () => {
  it('applies without lint and says the next edit re-lints it', () => {
    const { onParamsChange, onLintError } = renderEditor('Communication');
    fireEvent.paste(control('Number of processes'));
    fireEvent.change(control('Number of processes'), { target: { value: '4' } });
    expect(onParamsChange).toHaveBeenCalledWith([4, 'alone', 'std_io']);
    expect(onLintError).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Pasted content applied without lint. Edit manually to re-lint.')).not.toBeNull();
  });
});
