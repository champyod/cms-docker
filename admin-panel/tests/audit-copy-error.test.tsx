// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { AuditTable } from '@/components/audit/AuditTable';
import { getAuditEntry } from '@/app/actions/audit';
import type { AuditLogRow } from '@/app/actions/audit';

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; without it, queries bind to the
// accumulated document.body and later tests can grab stale buttons.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
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

function makeEntry(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
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

const DETAIL = {
  ...makeEntry(),
  before_values: { name: 'old' },
  after_values: { name: 'new' },
  ip: '10.0.0.1',
  session_id: 'sess-1',
  entry_hash: 'abc123',
  prev_hash: 'def456',
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn();
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

async function openDetail() {
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
  vi.mocked(getAuditEntry).mockResolvedValue({ success: true, data: DETAIL });
  const toggle = view.getAllByRole('button', { name: /toggle details/i })[0];
  fireEvent.click(toggle);
  await view.findByText('abc123');
  return view;
}

describe('AuditTable copy feedback', () => {
  it('surfaces a toast and keeps the copied state unset when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('Permission denied'));

    const view = await openDetail();
    fireEvent.click(view.getByRole('button', { name: 'Copy entry hash' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Copy failed. Select the text to copy it manually.',
      );
    });
    expect(view.container.querySelector('.lucide-check')).toBeNull();
  });

  it('shows the copied feedback when the clipboard write succeeds', async () => {
    writeText.mockResolvedValue(undefined);

    const view = await openDetail();
    fireEvent.click(view.getByRole('button', { name: 'Copy before' }));

    await waitFor(() => {
      expect(view.container.querySelector('.lucide-check')).not.toBeNull();
    });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});