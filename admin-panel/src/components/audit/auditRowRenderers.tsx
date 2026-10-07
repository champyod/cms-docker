'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ResponsiveRowProps } from '@/components/core/ResponsiveTable';
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

  // Why: shared by desktop rows and mobile cards, with 44px targets kept
  // in this fragment so both layouts stay touch-sized.
  const renderRowActions = (entry: AuditLogRow): React.JSX.Element => {
    const isExpanded = expandedRowId === entry.id;
    return (
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={`Toggle details for ${entry.verb} on ${entry.entity}`}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={(e) => {
          e.stopPropagation();
          void onRowClick(entry.id);
        }}
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
    );
  };

  return { getRowProps, renderRowActions };
}
