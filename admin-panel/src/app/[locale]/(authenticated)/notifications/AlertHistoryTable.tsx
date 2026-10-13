'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ExternalLink, Filter } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import type { AlertRow } from '@/lib/alert-history';
import { buildAlertColumns, type NotificationsCopy } from './alertColumns';

interface AlertHistoryTableProps {
  readonly copy: NotificationsCopy;
  readonly entries: AlertRow[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly pageSize: number;
  readonly recordHref: (entry: AlertRow) => string;
  readonly pageInput: string;
  readonly onPageInputChange: (value: string) => void;
  readonly onPageChange: (page: number) => void;
}

const ROW_ACTION_CLASS =
  'flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

/** The paged alert history: one column set, one row action, one pagination control. */
export function AlertHistoryTable({
  copy,
  entries,
  total,
  totalPages,
  currentPage,
  pageSize,
  recordHref,
  pageInput,
  onPageInputChange,
  onPageChange,
}: AlertHistoryTableProps): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const columns = useMemo(() => buildAlertColumns(copy, formatTimestamp), [copy, formatTimestamp]);
  return (
    <>
      <p className="text-sm text-muted-foreground">{copy.pageInfo.replace('{total}', String(total))}</p>
      <ResponsiveTable
        columns={columns}
        rows={entries}
        getRowKey={(entry) => entry.id}
        actionsHeader={<span className="sr-only">{copy.openRecord}</span>}
        renderRowActions={(entry) => (
          <Link href={recordHref(entry)} aria-label={`${copy.openRecord}: ${entry.verb}`} className={ROW_ACTION_CLASS}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        )}
        emptyState={<EmptyState icon={Filter} title={copy.noEntries} />}
      />
      {totalPages > 1 && (
        <TablePaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          pageInput={pageInput}
          onPageInputChange={onPageInputChange}
          onPageGo={() => onPageChange(Math.max(1, Math.min(Number(pageInput) || 1, totalPages)))}
          // Why the size is reported and not offered: the history pages at one size, so the control
          // shows it instead of pretending a reader may change it.
          perPage={pageSize}
          onPerPageChange={() => undefined}
          onPrev={() => onPageChange(currentPage - 1)}
          onNext={() => onPageChange(currentPage + 1)}
        />
      )}
    </>
  );
}
