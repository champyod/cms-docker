// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { DatasetModal } from '@/components/tasks/DatasetModal';

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ success: true, data: [] })),
    put: mocks.put,
    post: mocks.post,
  },
}));

afterEach(cleanup);

type ModalDataset = NonNullable<React.ComponentProps<typeof DatasetModal>['dataset']>;

function dataset(patch: Partial<ModalDataset> = {}): ModalDataset {
  return {
    id: 7, description: 'Live', time_limit: 1, memory_limit: 268435456,
    task_type: 'Batch', score_type: 'Sum', ...patch,
  };
}

function open(record?: ModalDataset): void {
  render(
    <DictionaryProvider dict={en}>
      <DatasetModal isOpen onClose={vi.fn()} taskId={4} onSuccess={vi.fn()} dataset={record} />
    </DictionaryProvider>,
  );
}

function limitBox(field: string): HTMLInputElement {
  const box = document.querySelector(`[data-field="${field}"] input`);
  if (!(box instanceof HTMLInputElement)) throw new Error(`the ${field} box is missing`);
  return box;
}

function limitToggle(field: string): HTMLElement {
  const toggle = document.querySelector(`[data-field="${field}"] button[aria-pressed]`);
  if (!(toggle instanceof HTMLElement)) throw new Error(`the ${field} toggle is missing`);
  return toggle;
}

function type(field: string, value: string): void {
  fireEvent.change(limitBox(field), { target: { value } });
}

async function submit(): Promise<void> {
  const form = document.getElementById('dataset-form');
  if (!(form instanceof HTMLFormElement)) throw new Error('the dataset form is missing');
  fireEvent.submit(form);
  await vi.waitFor(() => expect(mocks.put.mock.calls.length + mocks.post.mock.calls.length).toBeGreaterThan(0));
}

function lastPayload(): Record<string, unknown> {
  const call = [...mocks.put.mock.calls, ...mocks.post.mock.calls].at(-1);
  if (!call) throw new Error('no save was sent');
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.put.mockResolvedValue({ success: true, data: {} });
  mocks.post.mockResolvedValue({ success: true, data: {} });
});

describe('the dataset limits in the modal', () => {
  it('opens a NULL record as the unlimited state on both fields', () => {
    open(dataset({ time_limit: null, memory_limit: null }));

    expect(limitBox('time_limit').value).toBe('');
    expect(limitToggle('time_limit').getAttribute('aria-pressed')).toBe('true');
    expect(limitBox('memory_limit').value).toBe('');
    expect(limitToggle('memory_limit').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the NULL record NULL through the submit', async () => {
    open(dataset({ time_limit: null, memory_limit: null }));
    await submit();

    expect(mocks.put).toHaveBeenCalledWith('/api/datasets/7', expect.objectContaining({
      action: 'update', time_limit: null, memory_limit: null,
    }));
  });

  it('shows a stored pair as seconds and MiB, not as bytes', () => {
    open(dataset({ time_limit: 1.5, memory_limit: '268435456' }));

    expect(limitBox('time_limit').value).toBe('1.5');
    expect(limitToggle('time_limit').getAttribute('aria-pressed')).toBe('false');
    expect(limitBox('memory_limit').value).toBe('256');
    expect(limitToggle('memory_limit').getAttribute('aria-pressed')).toBe('false');
  });

  it('sends MiB, not bytes, so the route owns the one conversion', async () => {
    open(dataset({ time_limit: 1.5, memory_limit: '268435456' }));
    await submit();

    const payload = lastPayload();
    expect(payload.time_limit).toBe(1.5);
    expect(payload.memory_limit).toBe(256);
  });

  it('turns a typed then cleared box into a null the submit carries', async () => {
    open(dataset({ time_limit: 4, memory_limit: 64 }));

    type('time_limit', '');
    type('memory_limit', '0');

    expect(limitBox('time_limit').value).toBe('');
    expect(limitToggle('time_limit').getAttribute('aria-pressed')).toBe('true');
    expect(limitBox('memory_limit').value).toBe('');
    expect(limitToggle('memory_limit').getAttribute('aria-pressed')).toBe('true');

    await submit();
    expect(lastPayload()).toEqual(expect.objectContaining({ time_limit: null, memory_limit: null }));
  });

  it('clears a set limit to no limit from the toggle', async () => {
    open(dataset({ time_limit: 4, memory_limit: 64 }));

    fireEvent.click(limitToggle('time_limit'));
    fireEvent.click(limitToggle('memory_limit'));
    await submit();

    expect(lastPayload()).toEqual(expect.objectContaining({ time_limit: null, memory_limit: null }));
  });

  it('keeps a fractional time limit and refuses a fractional MiB', async () => {
    open(dataset({ time_limit: null, memory_limit: null }));

    type('time_limit', '1.5');
    type('memory_limit', '16.5');

    // The time column is a float, so the fraction survives; the memory column is a whole number of
    // MiB, so the entry is refused and the box clears back to no limit rather than storing a value
    // the database CHECK would reject.
    expect(limitBox('time_limit').value).toBe('1.5');
    expect(limitBox('memory_limit').value).toBe('');

    await submit();
    expect(lastPayload()).toEqual(expect.objectContaining({ time_limit: 1.5, memory_limit: null }));
  });

  it('stores NULL when a new dataset is created with both boxes cleared', async () => {
    open(undefined);

    type('time_limit', '');
    type('memory_limit', '');
    await submit();

    expect(mocks.post).toHaveBeenCalledWith('/api/datasets', expect.objectContaining({
      time_limit: null, memory_limit: null,
    }));
  });
});
