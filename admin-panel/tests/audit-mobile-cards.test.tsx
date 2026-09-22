// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/react';
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
    fromDate: 'From',
    toDate: 'To',
    apply: 'Apply',
    clear: 'Clear',
    allEntities: 'All Entities',
  },
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
  it('renders entry fields and failure badge on mobile card', () => {
    const entry = makeEntry({ id: '41', result: 'failure' });
    const { getByTestId } = render(
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
    const card = within(getByTestId('audit-mobile-card-41'));
    expect(card.getByText('task:update')).toBeTruthy();
    expect(card.getByText('failure')).toBeTruthy();
    expect(card.getByText('Fix limits')).toBeTruthy();
    expect(card.getByText('#7')).toBeTruthy();
    expect(card.getByText('12')).toBeTruthy();
  });
});
