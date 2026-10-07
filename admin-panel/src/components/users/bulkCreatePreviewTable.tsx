'use client';

import { useMemo } from 'react';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { PreviewRow } from './csvPreview';

const CARD_FIELDS = ['first_name', 'last_name', 'username', 'password', 'email', 'timezone', 'team'] as const;
type CardField = (typeof CARD_FIELDS)[number];
const MAX_VISIBLE_PREVIEW_ROWS = 100;

const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

interface PreviewTableProps {
  rows: PreviewRow[];
  totalRowCount: number;
  selectedRowIndices: Set<number>;
  onSelectAll: (checked: boolean) => void;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart. Empty strings render null so
// mobile omits the row while desktop keeps the empty cell.
function buildPreviewColumns(args: {
  selectedRowIndices: Set<number>;
  totalRowCount: number;
  onSelectAll: (checked: boolean) => void;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
}): ResponsiveColumn<PreviewRow>[] {
  const { selectedRowIndices, totalRowCount, onSelectAll, onToggleRow } = args;
  return [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          title="Select all rows"
          className={CHECKBOX_CLASS}
          checked={selectedRowIndices.size > 0 && selectedRowIndices.size === totalRowCount}
          onChange={(e) => onSelectAll(e.target.checked)}
        />
      ),
      mobileLabel: 'Select',
      render: (row) => (
        <input
          type="checkbox"
          title={`Select row ${row.rowIndex}`}
          className={CHECKBOX_CLASS}
          checked={selectedRowIndices.has(row.rowIndex)}
          onChange={(e) => onToggleRow(row.rowIndex, e.target.checked)}
        />
      ),
    },
    ...CARD_FIELDS.map((field: CardField): ResponsiveColumn<PreviewRow> => ({
      key: field,
      header: field,
      render: (row) => row[field] || null,
    })),
    {
      key: 'issues',
      header: 'Issues',
      render: (row) => <span className="text-warning">{row.issues.join(', ') || '-'}</span>,
    },
  ];
}

export function PreviewTable({ rows, totalRowCount, selectedRowIndices, onSelectAll, onToggleRow }: PreviewTableProps) {
  const rowsLeft = Math.max(totalRowCount - MAX_VISIBLE_PREVIEW_ROWS, 0);

  const columns = useMemo(
    () => buildPreviewColumns({ selectedRowIndices, totalRowCount, onSelectAll, onToggleRow }),
    [selectedRowIndices, totalRowCount, onSelectAll, onToggleRow],
  );

  return (
    <div>
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.rowIndex}
        getRowClassName={(row) => (selectedRowIndices.has(row.rowIndex) ? 'bg-primary/10' : undefined)}
        outerClassName="max-h-80"
        emptyState={<div className="py-2 text-center text-xs text-muted-foreground">No preview rows yet</div>}
      />
      {rowsLeft > 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/30">
          ... {rowsLeft} rows left (showing first {MAX_VISIBLE_PREVIEW_ROWS})
        </div>
      )}
    </div>
  );
}
