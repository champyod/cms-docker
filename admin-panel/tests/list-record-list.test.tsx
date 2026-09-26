// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Pencil } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { RecordList } from '@/components/list/RecordList';
import { RowActionLink } from '@/components/list/RowActionLink';

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; without it, later row queries
// would bind to the accumulated document.body.
afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/people/teams',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPush = vi.fn();

interface Row {
  id: number;
  name: string;
}

const ROWS: Row[] = [{ id: 4, name: 'Thailand Team 1' }];
const RECORD_HREF = '/en/people/teams/4';

const COLUMNS = [
  { key: 'id', header: 'ID', render: (row: Row) => <span>#{row.id}</span> },
  { key: 'name', header: 'Name', render: (row: Row) => <span>{row.name}</span> },
];

function renderRowActionLink(isPrimary = true): HTMLAnchorElement {
  const { container } = render(
    <RowActionLink href={RECORD_HREF} label="View team members" icon={<Pencil />} isPrimary={isPrimary} />,
  );
  const anchor = container.querySelector('a');
  if (!anchor) throw new Error('Missing row action anchor');
  return anchor;
}

describe('RowActionLink', () => {
  it('renders one anchor with no interactive element nested inside it', () => {
    const anchor = renderRowActionLink();

    expect(anchor.tagName).toBe('A');
    expect(anchor.getAttribute('href')).toBe(RECORD_HREF);
    expect(anchor.querySelector('button')).toBeNull();
    expect(anchor.querySelector('a')).toBeNull();
  });

  it('keeps the accessible name and the j/k shortcut marker on that same anchor', () => {
    const anchor = renderRowActionLink();

    expect(anchor.getAttribute('aria-label')).toBe('View team members');
    expect(anchor.getAttribute('data-shortcut-primary')).toBe('true');
  });

  it('omits the shortcut marker for a secondary row action', () => {
    const anchor = renderRowActionLink(false);

    expect(anchor.hasAttribute('data-shortcut-primary')).toBe(false);
  });

  it('stops propagation so the row handler does not also fire', () => {
    const outerClick = vi.fn();
    const { container } = render(
      // Why: the row is the click target in a real list, so the assertion has
      // to prove the event never reaches an ancestor.
      <div onClick={outerClick}>
        <RowActionLink href={RECORD_HREF} label="View team members" icon={<Pencil />} isPrimary />
      </div>,
    );
    const anchor = container.querySelector('a');
    if (!anchor) throw new Error('Missing row action anchor');

    fireEvent.click(anchor);

    expect(outerClick).not.toHaveBeenCalled();
  });
});

function renderList(rows: readonly Row[] = ROWS): HTMLElement {
  const { container } = render(
    <RecordList
      rows={rows}
      columns={COLUMNS}
      getRowKey={(row) => row.id}
      getRecordHref={() => RECORD_HREF}
      renderRowActions={(row) => (
        <RowActionLink href={RECORD_HREF} label={`Team ${row.id}`} icon={<Pencil />} isPrimary />
      )}
      emptyState={<EmptyState title="No teams found" description="Teams will appear here once created." />}
    />,
  );
  return container;
}

describe('RecordList', () => {
  it('routes a row click and an Enter press to the canonical record', () => {
    mockPush.mockClear();
    const container = renderList();

    const cell = container.querySelector('tbody tr td:nth-child(2)');
    if (!cell) throw new Error('Missing desktop row');
    fireEvent.click(cell);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toBe(RECORD_HREF);

    const row = container.querySelector('tbody tr');
    if (!row) throw new Error('Missing desktop row');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls[1][0]).toBe(RECORD_HREF);
  });

  it('marks the desktop row and the mobile card for j/k navigation', () => {
    const container = renderList();

    expect(container.querySelector('tbody tr')?.getAttribute('data-shortcut-row')).toBe('4');
    expect(container.querySelector('.space-y-3.md\\:hidden > div')?.getAttribute('data-shortcut-row')).toBe('4');
  });

  it('renders the row action in both layouts from one definition', () => {
    const container = renderList();

    const mobile = container.querySelector('.space-y-3.md\\:hidden a[href]');
    const desktop = container.querySelector('tbody tr a[href]');
    expect(mobile?.getAttribute('href')).toBe(RECORD_HREF);
    expect(desktop?.getAttribute('href')).toBe(RECORD_HREF);
    expect(desktop?.querySelector('button')).toBeNull();
  });

  it('falls back to the caller empty state when no row is readable', () => {
    mockPush.mockClear();
    const container = renderList([]);

    expect(container.querySelector('table')).toBeNull();
    expect(document.body.textContent).toContain('No teams found');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
