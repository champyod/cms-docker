// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getFileByDigest } from '@/app/actions/statements';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionSourceViewer } from '@/components/submissions/SubmissionSourceViewer';
import en from '@/dictionaries/en.json';
import type { SubmissionPreviousModel, SubmissionSourceModel } from '@/lib/evaluation-read-model-types';

vi.mock('@/app/actions/statements', () => ({ getFileByDigest: vi.fn() }));

const mockGetFileByDigest = vi.mocked(getFileByDigest);

// Why: globals are disabled in vitest.config.ts, so cleanup does not run on its own.
afterEach(() => {
  cleanup();
});

const DIGEST_FILES: Record<string, string> = {
  'digest-prev': 'int main() {\n  return 1;\n}\n',
  'digest-current': 'int main() {\n  return 0;\n}\n',
};

function readableSource(submissionId: number, digest: string): SubmissionSourceModel {
  return {
    submissionId,
    language: 'C++17 / g++',
    sourceReadable: true,
    filename: 'sol.cpp',
    digest,
  };
}

function previousSource(source: SubmissionSourceModel | null): SubmissionPreviousModel {
  return { submissionId: 7, timestamp: '2026-01-01T00:00:00.000Z', source };
}

function longSource(): string {
  return Array.from({ length: 20 }, (_, index) => `int v${index + 1} = ${index + 1};`).join('\n') + '\n';
}

function renderViewer(
  source: SubmissionSourceModel | null,
  previous: SubmissionPreviousModel | null = null,
): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionSourceViewer source={source} previous={previous} />
    </DictionaryProvider>,
  );
  return container;
}

function scrollBox(container: HTMLElement): HTMLElement {
  const box = container.querySelector('[role="region"]');
  if (box === null) throw new Error('the viewer rendered no code region');
  return box as HTMLElement;
}

function rowsOf(container: HTMLElement, kind: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(`[data-diff-kind="${kind}"]`)) as HTMLElement[];
}

beforeEach(() => {
  mockGetFileByDigest.mockReset();
  mockGetFileByDigest.mockImplementation(async (digest: string) => {
    const code = DIGEST_FILES[digest];
    return code === undefined ? null : { data: Buffer.from(code, 'utf8').toString('base64') };
  });
});

describe('Submission source and diff', () => {
  it('fetches both digests and shows the changed lines in one inline diff', async () => {
    const container = renderViewer(readableSource(19, 'digest-current'), previousSource(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('1 added, 1 removed'));
    expect(mockGetFileByDigest).toHaveBeenCalledWith('digest-prev');
    expect(mockGetFileByDigest).toHaveBeenCalledWith('digest-current');
    expect(container.textContent).toContain('Previous #7');
    expect(container.textContent).toContain('Current #19');
    // The removed line is the previous submission's, the added line this one's, both in the flow.
    expect(rowsOf(container, 'removed').map((row) => row.textContent)).toEqual(['2-  return 1;']);
    expect(rowsOf(container, 'added').map((row) => row.textContent)).toEqual(['2+  return 0;']);
    expect(rowsOf(container, 'same')).toHaveLength(2);
  });

  it('renders the source as highlighted code inside the card, with no surface of its own', async () => {
    const container = renderViewer(readableSource(19, 'digest-current'), previousSource(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('return 0;'));
    const box = scrollBox(container);
    // Why the class and not a background utility: the syntax colours are scoped to `.source-code`
    // in globals.css, so the block inherits the card's colour instead of painting its own.
    expect(box.className).toContain('source-code');
    expect(box.className).not.toContain('hljs');
    expect(box.className).not.toContain('bg-');
    expect(box.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('drops the previous-submission column when no earlier submission stores a file', async () => {
    const container = renderViewer(readableSource(19, 'digest-current'), previousSource(null));

    await waitFor(() => expect(container.textContent).toContain('return 0;'));
    expect(mockGetFileByDigest).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Previous #7');
    expect(rowsOf(container, 'same')).toHaveLength(3);
    expect(rowsOf(container, 'added')).toHaveLength(0);
  });

  it('falls back to the plain source when the previous submission is unreadable', async () => {
    const container = renderViewer(
      readableSource(19, 'digest-current'),
      previousSource({ submissionId: 7, language: 'cpp', sourceReadable: false }),
    );

    await waitFor(() => expect(container.textContent).toContain('return 0;'));
    expect(mockGetFileByDigest).toHaveBeenCalledTimes(1);
    expect(rowsOf(container, 'removed')).toHaveLength(0);
    expect(container.textContent).not.toContain('Previous #7');
  });

  it('reports no changes when the two sources are line-identical', async () => {
    DIGEST_FILES['digest-current'] = DIGEST_FILES['digest-prev'];
    const container = renderViewer(readableSource(19, 'digest-current'), previousSource(readableSource(7, 'digest-prev')));

    await waitFor(() => expect(container.textContent).toContain('No line changes between the two sources.'));
    expect(rowsOf(container, 'added')).toHaveLength(0);
    expect(rowsOf(container, 'removed')).toHaveLength(0);
  });

  it('never asks for the bytes when the reader lacks file:read', () => {
    const container = renderViewer({ submissionId: 19, language: 'cpp', sourceReadable: false });

    expect(container.textContent).toContain('Hidden — requires file:read');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('reports a submission with no stored file without asking for bytes', () => {
    const container = renderViewer(null);

    expect(container.textContent).toContain('No stored source file.');
    expect(mockGetFileByDigest).not.toHaveBeenCalled();
  });

  it('surfaces a digest that resolves to no bytes', async () => {
    mockGetFileByDigest.mockResolvedValue(null);

    const container = renderViewer(readableSource(19, 'digest-current'));

    await waitFor(() => expect(container.textContent).toContain('No stored contents for this file.'));
    expect(container.textContent).not.toContain(en.submissions.record.source.loading);
  });

  it('surfaces a failed fetch without leaving a loading line', async () => {
    mockGetFileByDigest.mockRejectedValue(new Error('Missing fsobject:read permission'));

    const container = renderViewer(readableSource(19, 'digest-current'));

    await waitFor(() => expect(container.textContent).toContain('Missing fsobject:read permission'));
    expect(container.textContent).not.toContain(en.submissions.record.source.loading);
  });

  it('renders the loading status until the bytes resolve', () => {
    mockGetFileByDigest.mockReturnValue(new Promise(() => undefined));

    renderViewer(readableSource(19, 'digest-current'));

    expect(screen.getByRole('status').textContent).toBe(en.submissions.record.source.loading);
  });

  it('collapses a long file to its first rows and expands on demand', async () => {
    mockGetFileByDigest.mockResolvedValue({ data: Buffer.from(longSource(), 'utf8').toString('base64') });
    const container = renderViewer(readableSource(19, 'digest-current'));

    await waitFor(() => expect(container.textContent).toContain('int v1 = 1;'));
    expect(rowsOf(container, 'same')).toHaveLength(12);
    expect(container.textContent).not.toContain('int v13 = 13;');
    expect(container.querySelector('[aria-hidden="true"].bg-gradient-to-t')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.submissions.record.source.showFull }));
    expect(rowsOf(container, 'same')).toHaveLength(20);
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.submissions.record.source.collapse }));
    expect(container.querySelector('[aria-hidden="true"].bg-gradient-to-t')).not.toBeNull();
  });

  it('wraps long lines by default and toggles back to horizontal scroll', async () => {
    const container = renderViewer(readableSource(19, 'digest-current'));

    await waitFor(() => expect(container.textContent).toContain('return 0;'));
    const toggle = screen.getByRole('button', { name: en.submissions.record.source.wrap });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(scrollBox(container).querySelector('code')?.className).toContain('whitespace-pre-wrap');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(scrollBox(container).querySelector('code')?.className).not.toContain('whitespace-pre-wrap');
  });

  it('offers per-file Download and Copy beside the code', async () => {
    renderViewer(readableSource(19, 'digest-current'));

    await waitFor(() => expect(screen.getByRole('button', { name: en.submissions.record.source.copy })).not.toBeNull());
    expect(screen.getByRole('button', { name: en.submissions.record.source.download })).not.toBeNull();
  });
});
