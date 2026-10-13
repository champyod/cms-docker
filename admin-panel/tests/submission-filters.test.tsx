// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionList, type SubmissionFilters } from '@/components/submissions/SubmissionList';
import type { SubmissionListItem } from '@/types';

// Why: globals are disabled in vitest.config.ts, so the automatic afterEach cleanup
// does not run and later queries would bind to the accumulated document.body.
afterEach(() => cleanup());

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/evaluation/submissions',
  useSearchParams: () => new URLSearchParams(),
}));

const SUBMISSION_ROW = {
  id: 19,
  timestamp: new Date('2026-02-03T04:05:06.000Z'),
  language: 'cpp',
  comment: '',
  official: false,
  tasks: { id: 3, name: 'sum', title: 'Sum' },
  participations: { users: { username: 'ada' }, contests: { name: 'Thailand Cup' } },
  submission_results: [],
  files: [],
} as unknown as SubmissionListItem;

function renderList(filters?: SubmissionFilters): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionList
        initialSubmissions={[SUBMISSION_ROW]}
        totalPages={1}
        currentPage={1}
        navigation={en.navigation}
        filters={filters}
      />
    </DictionaryProvider>,
  );
  return container;
}

function field(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector(`input[name="${name}"]`);
  if (!input) throw new Error(`Missing filter field: ${name}`);
  return input as HTMLInputElement;
}

function submit(container: HTMLElement): void {
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing filter form');
  fireEvent.submit(form);
}

describe('submission list filters', () => {
  it('renders a filter form even when no filter is active', () => {
    const container = renderList();
    expect(container.querySelector('form')).toBeTruthy();
    expect(field(container, 'contest').value).toBe('');
  });

  it('pushes the three narrowing parameters the query already supports', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'contest'), { target: { value: '2' } });
    fireEvent.change(field(container, 'task'), { target: { value: '5' } });
    fireEvent.change(field(container, 'user'), { target: { value: '9' } });
    submit(container);

    const pushed = new URL(mockPush.mock.calls[0][0]);
    expect(pushed.searchParams.get('contest')).toBe('2');
    expect(pushed.searchParams.get('task')).toBe('5');
    expect(pushed.searchParams.get('user')).toBe('9');
  });

  it('pushes the trimmed search term alongside the id narrowing', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'search'), { target: { value: '  ada  ' } });
    fireEvent.change(field(container, 'contest'), { target: { value: '2' } });
    submit(container);

    const pushed = new URL(mockPush.mock.calls[0][0]);
    expect(pushed.searchParams.get('search')).toBe('ada');
    expect(pushed.searchParams.get('contest')).toBe('2');
  });

  it('drops a blank search rather than sending an empty term', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'search'), { target: { value: '   ' } });
    submit(container);

    expect(new URL(mockPush.mock.calls[0][0]).searchParams.has('search')).toBe(false);
  });

  it('resets to page 1 when a filter is applied', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'contest'), { target: { value: '2' } });
    submit(container);

    // Why page must reset: page 4 of the unfiltered list is not page 4 of a narrowed
    // one, and keeping it would show an empty page that reads as "no matches".
    expect(new URL(mockPush.mock.calls[0][0]).searchParams.get('page')).toBe('1');
  });

  it('prefills the fields from the active filters', () => {
    const container = renderList({ contestId: 7, taskId: 3, userId: 11, search: 'ada' });
    expect(field(container, 'contest').value).toBe('7');
    expect(field(container, 'task').value).toBe('3');
    expect(field(container, 'user').value).toBe('11');
    expect(field(container, 'search').value).toBe('ada');
  });

  it('drops a non-numeric value rather than filtering on zero', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'contest'), { target: { value: 'abc' } });
    submit(container);

    // Why: contest id 0 matches nothing, so a typo would render an empty list that looks
    // like a genuine "no submissions" answer instead of a rejected filter.
    const pushed = new URL(mockPush.mock.calls[0][0]);
    expect(pushed.searchParams.has('contest')).toBe(false);
  });

  it('drops a negative or zero id rather than sending it', () => {
    mockPush.mockClear();
    const container = renderList();
    fireEvent.change(field(container, 'user'), { target: { value: '-4' } });
    submit(container);

    expect(new URL(mockPush.mock.calls[0][0]).searchParams.has('user')).toBe(false);
  });

  it('clears every filter and the fields when Clear is pressed', () => {
    mockPush.mockClear();
    const container = renderList({ contestId: 7, search: 'ada' });
    const clear = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Clear');
    if (!clear) throw new Error('Missing Clear control');
    fireEvent.click(clear);

    const pushed = new URL(mockPush.mock.calls[0][0]);
    expect(pushed.searchParams.has('contest')).toBe(false);
    expect(pushed.searchParams.has('search')).toBe(false);
    expect(field(container, 'contest').value).toBe('');
    expect(field(container, 'search').value).toBe('');
  });

  it('offers Clear when only a search is active', () => {
    const container = renderList({ search: 'ada' });
    const clear = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Clear');
    expect(clear).toBeTruthy();
  });

  it('offers no Clear control when nothing is filtered', () => {
    const container = renderList();
    const clear = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Clear');
    expect(clear).toBeUndefined();
  });
});
