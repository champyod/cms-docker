'use client';

import type { ResponsiveRowProps } from '@/components/core/ResponsiveTable';
import { RowExpandAction } from '@/components/list/RowExpandAction';
import type { AuditLogRow } from '@/app/actions/audit';

export function createAuditRowRenderers(
  expandedRowId: string | null,
  onRowClick: (id: string) => void,
): {
  getRowProps: (entry: AuditLogRow) => ResponsiveRowProps;
  renderRowActions: (entry: AuditLogRow) => React.JSX.Element;
} {
  const getRowProps = (entry: AuditLogRow): ResponsiveRowProps => ({
    onClick: () => {
      void onRowClick(entry.id);
    },
    className: 'cursor-pointer',
    'aria-expanded': expandedRowId === entry.id,
  });

  // Why: shared by desktop rows and mobile cards, so both layouts stay touch-sized.
  const renderRowActions = (entry: AuditLogRow): React.JSX.Element => (
    <RowExpandAction
      expanded={expandedRowId === entry.id}
      ariaLabel={`Toggle details for ${entry.verb} on ${entry.entity}`}
      onToggle={() => {
        void onRowClick(entry.id);
      }}
    />
  );

  return { getRowProps, renderRowActions };
}
