// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AuditTable } from '@/components/audit/AuditTable';
import type { AuditLogRow } from '@/app/actions/audit';

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
    entityId: 'Entity ID',
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
    result: 'success',
    reason: 'Fix limits',
    ...overrides,
  };
}

describe('AuditTable mobile cards', () => {
  it('renders entry fields and failure badge in row and card', () => {
    const entry = makeEntry({ id: '41', result: 'failure' });
    const { getAllByText } = render(
      <AuditTable
        entries={[entry]}
        total={1}
        totalPages={1}
        currentPage={1}
        filters={{}}
        dict={DICT}
        permissionKeys={[]}
      />
    );
    // Why: ResponsiveTable renders one row model in both layouts, so
    // each value appears twice (desktop row + mobile card).
    expect(getAllByText('task:update').length).toBeGreaterThan(0);
    expect(getAllByText('failure').length).toBeGreaterThan(0);
    expect(getAllByText('Fix limits').length).toBeGreaterThan(0);
    expect(getAllByText('#7').length).toBeGreaterThan(0);
    expect(getAllByText('12').length).toBeGreaterThan(0);
  });
});
