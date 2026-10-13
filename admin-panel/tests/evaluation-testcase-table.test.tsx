// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TestcaseDetailTable } from '@/components/submissions/TestcaseDetailTable';
import type { SubmissionEvaluationModel } from '@/lib/evaluation-read-model-types';

// Why: globals are disabled in vitest.config.ts, so cleanup does not run on its own.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MODEL: SubmissionEvaluationModel = {
  submissionId: 19,
  evaluations: [
    {
      id: 1,
      datasetId: 1,
      testcaseId: 2,
      testcaseName: 'test-2',
      outcome: '1.0',
      text: ['ok'],
      executionTime: 0.5,
      executionMemory: '1048576',
    },
    {
      id: 2,
      datasetId: 1,
      testcaseId: 3,
      testcaseName: null,
      outcome: '0.0',
      text: [],
      executionTime: null,
      executionMemory: null,
    },
  ],
};

const DETAIL_PAYLOAD = {
  success: true,
  submissionId: 19,
  testcaseId: 2,
  testcaseName: 'test-2',
  input: '1 2\n',
  expectedOutput: '3\n',
  output: null,
};

const mockFetch = vi.fn();

function jsonResponse(ok: boolean, body: object): { ok: boolean; json: () => Promise<object> } {
  return { ok, json: async () => body };
}

function toggleButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: `Toggle details for ${label}` });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

describe('Submission testcase table', () => {
  it('shows one row per testcase, verdict, time and memory, and fetches nothing', () => {
    const { container } = render(<TestcaseDetailTable model={MODEL} />);

    expect(screen.getByText('test-2')).not.toBeNull();
    expect(screen.getByText('Testcase #3')).not.toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(MODEL.evaluations.length + 1);
    expect(container.textContent).toContain('1.0');
    expect(container.textContent).toContain('0.500s');
    expect(container.textContent).toContain('1.00 MiB');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches one testcase through the gated route when its row opens', async () => {
    mockFetch.mockResolvedValue(jsonResponse(true, DETAIL_PAYLOAD));
    const { container } = render(<TestcaseDetailTable model={MODEL} />);

    fireEvent.click(toggleButton('test-2'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('/api/submissions/19/testcase/2');
    await waitFor(() => expect(container.textContent).toContain('1 2'));
    expect(container.textContent).toContain('Expected output');
    expect(container.textContent).toContain('Submission output');
    expect(container.textContent).toContain('Not stored');
  });

  it('fetches the row that was opened, not the first one', async () => {
    mockFetch.mockResolvedValue(jsonResponse(true, { ...DETAIL_PAYLOAD, testcaseId: 3, testcaseName: null }));
    render(<TestcaseDetailTable model={MODEL} />);

    fireEvent.click(toggleButton('Testcase #3'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('/api/submissions/19/testcase/3');
  });

  it('collapses the row and keeps its fetch count at one', async () => {
    mockFetch.mockResolvedValue(jsonResponse(true, DETAIL_PAYLOAD));
    const { container } = render(<TestcaseDetailTable model={MODEL} />);

    fireEvent.click(toggleButton('test-2'));
    await waitFor(() => expect(container.textContent).toContain('1 2'));
    fireEvent.click(toggleButton('test-2'));

    await waitFor(() => expect(container.textContent).not.toContain('1 2'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the route error without leaving a loading line', async () => {
    mockFetch.mockResolvedValue(jsonResponse(false, { success: false, error: 'Testcase not found for this submission' }));
    const { container } = render(<TestcaseDetailTable model={MODEL} />);

    fireEvent.click(toggleButton('test-2'));

    await waitFor(() => expect(container.textContent).toContain('Testcase not found for this submission'));
    expect(container.textContent).not.toContain('Loading testcase');
  });
});
