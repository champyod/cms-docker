// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';

interface Person {
  id: number;
  name: string;
  email: string;
}

const ROWS: Person[] = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
];

const COLUMNS: ResponsiveColumn<Person>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'email', header: 'Email', mobileLabel: 'E-mail', hideOnMobile: true, render: (row) => row.email },
];

function baseProps() {
  return {
    columns: COLUMNS,
    rows: ROWS,
    getRowKey: (row: Person): number => row.id,
  };
}

describe('ResponsiveTable', () => {
  it('renders desktop headers and cells from a single column definition', () => {
    const { getByRole, getAllByRole } = render(<ResponsiveTable {...baseProps()} />);
    expect(getByRole('table')).toBeTruthy();
    expect(getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Name', 'Email']);
    expect(getByRole('table').textContent).toContain('Ada Lovelace');
  });

  it('renders mobile cards with labels and honours hideOnMobile', () => {
    const { container } = render(<ResponsiveTable {...baseProps()} />);
    const mobile = container.querySelector('.space-y-3.md\\:hidden');
    expect(mobile?.textContent).toContain('Name');
    expect(mobile?.textContent).toContain('Ada Lovelace');
    expect(mobile?.textContent).not.toContain('ada@example.com');
  });

  it('shares the row actions slot between desktop and mobile layouts', () => {
    const { container, getAllByRole } = render(
      <ResponsiveTable {...baseProps()} renderRowActions={(row) => <button>Edit {row.id}</button>} />
    );
    expect(getAllByRole('button', { name: 'Edit 1' })).toHaveLength(2);
    expect(container.querySelector('.space-y-3.md\\:hidden')?.textContent).toContain('Edit 1');
  });

  it('passes a custom empty state through when rows are empty', () => {
    const { getByText } = render(
      <ResponsiveTable {...baseProps()} rows={[]} emptyState={<p>No people yet</p>} />
    );
    expect(getByText('No people yet')).toBeTruthy();
  });

  it('spreads getRowProps onto desktop rows and mobile cards', () => {
    const { container } = render(
      <ResponsiveTable {...baseProps()} getRowProps={(row) => ({ 'data-shortcut-row': row.id })} />
    );
    const desktopRow = container.querySelector('tbody tr');
    expect(desktopRow?.getAttribute('data-shortcut-row')).toBe('1');
    const mobileCard = container.querySelector('.space-y-3.md\\:hidden > div');
    expect(mobileCard?.getAttribute('data-shortcut-row')).toBe('1');
  });

  it('omits null column values from mobile cards but keeps the desktop cell', () => {
    interface Item {
      id: number;
      name: string;
    }
    const columns: ResponsiveColumn<Item>[] = [
      { key: 'name', header: 'Name', render: (row) => row.name },
      { key: 'badge', header: 'Badge', render: () => null },
    ];
    const { container } = render(
      <ResponsiveTable columns={columns} rows={[{ id: 1, name: 'Plain' }]} getRowKey={(row) => row.id} />
    );
    const mobile = container.querySelector('.space-y-3.md\\:hidden');
    expect(mobile?.textContent).toContain('Plain');
    expect(mobile?.textContent).not.toContain('Badge');
    // Why: container-scoped — earlier renders in this file stay mounted
    // (no auto-cleanup), so a global role query would match stale tables.
    expect(container.querySelectorAll('table tbody td')).toHaveLength(2);
  });
});
