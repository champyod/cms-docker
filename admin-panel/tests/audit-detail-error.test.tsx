// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AuditTable } from '@/components/audit/AuditTable';
import { getAuditEntry } from '@/app/actions/audit';
import type { AuditLogRow } from '@/app/actions/audit';

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; without it, queries bind to the
// accumulated document.body and later tests can grab stale buttons.
afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/actions/audit', () => ({
  getDistinctEntities: () => Promise.resolve({ success: true, data: [] }),
  getAuditEntry: vi.fn(),
}));

const DICT = {
  title: 'Audit Log',
  subtitle: 'Browse and inspect every recorded action in the system.',
  columns: {
    timestamp: 'Timestamp',
    actor: 'Actor',
    verb: 'Verb',
    entity: 'Entity',
    entityName: 'Name / Title',
    result: 'Result',
    reason: 'Reason',
  },
  filters: {
    entity: 'Entity',
    verb: 'Verb',
    actorId: 'Actor ID',
    result: 'Result',
    allResults: 'All Results',
    search: 'Search',
    searchPlaceholder: 'Search audit log…',
    fromDate: 'From',
    toDate: 'To',
    apply: 'Apply',
    clear: 'Clear',
    allEntities: 'All Entities',
  },
  exportCsv: 'Export CSV',
  autoRefresh: 'Auto-refresh',
  noEntries: 'No audit entries found.',
  pageInfo: '{total} entries total',
  expandedDetails: 'Details',
  detailLoadFailed: 'Could not load details',
  beforeValues: 'Before',
  afterValues: 'After',
  ip: 'IP Address',
  sessionId: 'Session ID',
  entryHash: 'Entry Hash',
  prevHash: 'Previous Hash',
};

function makeEntry(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: '1',
    actor_id: 7,
    actor_name: 'Admin',
    timestamp: new Date('2026-01-15T08:30:00Z').toISOString(),
    verb: 'task:update',
    entity: 'task',
    entity_id: '12',
    entity_name: 'Practice Round',
    result: 'success',
    reason: 'Fix limits',
    ...overrides,
  };
}

describe('AuditTable detail expansion failure', () => {
  it('surfaces the error when the detail fetch fails', async () => {
    const mockedGetAuditEntry = vi.mocked(getAuditEntry);
    mockedGetAuditEntry.mockResolvedValue({ success: false, error: 'Audit entry not found' });

    const view = render(
      <AuditTable
        entries={[makeEntry()]}
        total={1}
        totalPages={1}
        currentPage={1}
        filters={{}}
        dict={DICT}
        permissionKeys={[]}
      />
    );

    const toggle = view.getAllByRole('button', { name: /toggle details/i })[0];
    fireEvent.click(toggle);

    expect(await view.findByText(/Could not load details: Audit entry not found/i)).toBeTruthy();
  });

  it('clears the error when the row collapses', async () => {
    const mockedGetAuditEntry = vi.mocked(getAuditEntry);
    mockedGetAuditEntry.mockResolvedValue({ success: false, error: 'gone' });

    const view = render(
      <AuditTable
        entries={[makeEntry()]}
        total={1}
        totalPages={1}
        currentPage={1}
        filters={{}}
        dict={DICT}
        permissionKeys={[]}
      />
    );

    const toggle = view.getAllByRole('button', { name: /toggle details/i })[0];
    fireEvent.click(toggle);
    expect(await view.findByText(/Could not load details: gone/i)).toBeTruthy();

    fireEvent.click(toggle);
    expect(view.queryByText(/Could not load details/i)).toBeNull();
  });
});