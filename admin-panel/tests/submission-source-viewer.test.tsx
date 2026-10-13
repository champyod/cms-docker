// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getFileByDigest } from '@/app/actions/statements';
import { SubmissionSourceViewer } from '@/components/submissions/SubmissionSourceViewer';
import type { SubmissionSourceModel } from '@/lib/evaluation-read-model-types';

vi.mock('@/app/actions/statements', () => ({ getFileByDigest: vi.fn() }));

const mockGetFileByDigest = vi.mocked(getFileByDigest);

// Why: globals are disabled in vitest.config.ts, so cleanup does not run on its own.
afterEach(() => {
  cleanup();
});

const LONG_SOURCE = 'print("hello world")\n'.repeat(5);
const PREVIEW = LONG_SOURCE.slice(0, 50);

function readableSource(overrides: Partial<{ language: string | null; filename: string; digest: string }> = {}): SubmissionSourceModel {
  return {
    submissionId: 19,
    language: 'Python 3 / CPython',
    sourceReadable: true,
    filename: 'sol.py',
    digest: 'digest-1',
    ...overrides,
  };
}

function storedFile(code: string): { data: string } {
  return { data: Buffer.from(code, 'utf8').toString('base64') };
}

beforeEach(() => {
  mockGetFileByDigest.mockReset();
  mockGetFileByDigest.mockResolvedValue(storedFile(LONG_SOURCE));
});

describe('Submission source viewer', () => {
  it('fetches the file by digest when it renders and shows a 50-character preview', async () => {
    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.textContent).toContain(PREVIEW));
    expect(mockGetFileByDigest).toHaveBeenCalledTimes(1);
    expect(mockGetFileByDigest).toHaveBeenCalledWith('digest-1');
    expect(container.textContent).not.toContain(LONG_SOURCE.slice(0, 60));
    expect(screen.getByText('sol.py')).not.toBeNull();
  });

  it('highlights the code with highlight.js markers for the submission language', async () => {
    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.querySelector('.hljs-string')).not.toBeNull());
    expect(container.querySelector('.hljs')?.innerHTML).toContain('hljs-');
  });

  it('expands to the full text and collapses without a second fetch', async () => {
    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.textContent).toContain(PREVIEW));
    fireEvent.click(screen.getByRole('button', { name: 'Show full code' }));

    expect(container.textContent).toContain(LONG_SOURCE);
    expect(mockGetFileByDigest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

    expect(container.textContent).not.toContain(LONG_SOURCE.slice(0, 60));
  });

  it('hides the expand control for code that fits the preview', async () => {
    mockGetFileByDigest.mockResolvedValue(storedFile('print(1)\n'));

    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.textContent).toContain('print(1)'));
    expect(screen.queryByRole('button', { name: 'Show full code' })).toBeNull();
  });

  it('never asks for the bytes when the reader lacks file:read', () => {
    const { container } = render(<SubmissionSourceViewer source={{ submissionId: 19, language: 'cpp', sourceReadable: false }} />);

    expect(container.textContent).toContain('Hidden — requires file:read');
    expect(container.textContent).not.toContain('Show full code');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('reports a submission with no stored file without asking for bytes', () => {
    const { container } = render(<SubmissionSourceViewer source={null} />);

    expect(container.textContent).toContain('No stored source file.');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('surfaces a digest that resolves to no bytes', async () => {
    mockGetFileByDigest.mockResolvedValue(null);

    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.textContent).toContain('No stored contents for this file.'));
    expect(container.textContent).not.toContain('Loading source');
  });

  it('surfaces a failed fetch without leaving a loading line', async () => {
    mockGetFileByDigest.mockRejectedValue(new Error('Missing fsobject:read permission'));

    const { container } = render(<SubmissionSourceViewer source={readableSource()} />);

    await waitFor(() => expect(container.textContent).toContain('Missing fsobject:read permission'));
    expect(container.textContent).not.toContain('Loading source');
  });
});
