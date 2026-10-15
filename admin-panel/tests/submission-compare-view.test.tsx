// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { getFileByDigest } from '@/app/actions/statements';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionCompareView } from '@/components/submissions/SubmissionCompareView';
import en from '@/dictionaries/en.json';
import type { SubmissionPreviousModel, SubmissionSourceModel } from '@/lib/evaluation-read-model-types';

vi.mock('@/app/actions/statements', () => ({ getFileByDigest: vi.fn() }));

const mockGetFileByDigest = vi.mocked(getFileByDigest);

afterEach(() => {
  cleanup();
});

function readableSource(submissionId: number, digest: string): SubmissionSourceModel {
  return {
    submissionId,
    language: 'C++17 / g++',
    sourceReadable: true,
    filename: 'sol.cpp',
    digest,
  };
}

function previous(source: SubmissionSourceModel | null): SubmissionPreviousModel {
  return { submissionId: 7, timestamp: '2026-01-01T00:00:00.000Z', source };
}

function storedFile(code: string): { data: string } {
  return { data: Buffer.from(code, 'utf8').toString('base64') };
}

function renderCompare(current: SubmissionSourceModel | null, previousModel: SubmissionPreviousModel): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionCompareView current={current} previous={previousModel} />
    </DictionaryProvider>,
  );
  return container;
}

beforeEach(() => {
  mockGetFileByDigest.mockReset();
});

describe('Submission compare view', () => {
  it('fetches both digests and renders the aligned diff', async () => {
    mockGetFileByDigest
      .mockResolvedValueOnce(storedFile('int main() {\n  return 1;\n}'))
      .mockResolvedValueOnce(storedFile('int main() {\n  return 0;\n}'));
    const container = renderCompare(readableSource(19, 'digest-current'), previous(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('1 added, 1 removed'));
    expect(mockGetFileByDigest).toHaveBeenCalledWith('digest-prev');
    expect(mockGetFileByDigest).toHaveBeenCalledWith('digest-current');
    expect(container.textContent).toContain('Previous #7');
    expect(container.textContent).toContain('Current #19');
    expect(container.textContent).toContain('return 1;');
    expect(container.textContent).toContain('return 0;');
  });

  it('reports no changes when the two sources are identical', async () => {
    mockGetFileByDigest.mockResolvedValue(storedFile('int main() {\n  return 0;\n}'));
    const container = renderCompare(readableSource(19, 'digest-current'), previous(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('No line changes between the two sources.'));
  });

  it('never asks for bytes when the current submission stores no file', () => {
    const container = renderCompare(null, previous(readableSource(7, 'digest-prev')));

    expect(container.textContent).toContain('No stored source file.');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('never asks for bytes when the reader lacks file:read on the current source', () => {
    const container = renderCompare({ submissionId: 19, language: 'cpp', sourceReadable: false }, previous(readableSource(7, 'digest-prev')));

    expect(container.textContent).toContain('Hidden — requires file:read');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('never asks for bytes when the previous submission stores no file', () => {
    const container = renderCompare(readableSource(19, 'digest-current'), previous(null));

    expect(container.textContent).toContain('No stored source file.');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('never asks for bytes when the reader lacks file:read on the previous source', () => {
    const container = renderCompare(
      readableSource(19, 'digest-current'),
      previous({ submissionId: 7, language: 'cpp', sourceReadable: false }),
    );

    expect(container.textContent).toContain('Hidden — requires file:read');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('surfaces a digest that resolves to no bytes', async () => {
    mockGetFileByDigest.mockResolvedValue(null);
    const container = renderCompare(readableSource(19, 'digest-current'), previous(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('No stored contents for this file.'));
  });

  it('surfaces a failed fetch without leaving a loading line', async () => {
    mockGetFileByDigest.mockRejectedValue(new Error('Missing fsobject:read permission'));
    const container = renderCompare(readableSource(19, 'digest-current'), previous(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('Missing fsobject:read permission'));
    expect(container.textContent).not.toContain('Loading comparison');
  });

  it('renders the loading status until the bytes resolve', () => {
    mockGetFileByDigest.mockReturnValue(new Promise(() => undefined));
    renderCompare(readableSource(19, 'digest-current'), previous(readableSource(7, 'digest-prev')));

    expect(screen.getByRole('status').textContent).toBe('Loading comparison…');
  });
});
