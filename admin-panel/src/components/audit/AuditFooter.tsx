'use client';

import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { exportAuditLog } from '@/app/actions/audit-export';
import { Button } from '@/components/core/Button';
import { InlineAlert } from '@/components/core/InlineAlert';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { useAppRouter } from '@/hooks/useAppRouter';

import type { AuditDict, AuditFilterValues } from './auditTypes';

export interface AuditFooterProps {
  readonly dict: AuditDict;
  /** The narrowing the request carried, so the export covers the rows the reader is looking at. */
  readonly filters: AuditFilterValues;
  /** The count for the whole log under the current narrowing, never the length of this page. */
  readonly total: number;
  readonly currentPage: number;
  readonly totalPages: number;
  /** True when the address asked for the live cursor, which is what keeps the rows current. */
  readonly autoRefresh: boolean;
}

/**
 * The arithmetic and the three whole-log controls, under the rows they describe.
 *
 * WHY the count sits here and not above the table: it describes the whole log under the filter, not
 * any row on screen, so reading it after the rows keeps it from pushing them down.
 *
 * WHY the export takes the filter from the request: the file has to hold what the reader narrowed
 * to, so it is the narrowing the rows were read with rather than a second copy of the control state
 * that could have been edited without pressing Apply.
 *
 * WHY the live cursor is a link and not local state: it belongs to the address, so a reload or a
 * shared link opens the log with the same refresh the reader chose.
 */
export function AuditFooter({
  dict,
  filters,
  total,
  currentPage,
  totalPages,
  autoRefresh,
}: AuditFooterProps): React.JSX.Element {
  const router = useAppRouter();
  // Why the hook and not window.location.pathname: it hands back the path with the base path stripped.
  const pathname = usePathname();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [pageInput, setPageInput] = useState(String(currentPage));

  function queryFor(overrides: { readonly page?: number; readonly live?: boolean }): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      entity: filters.entity,
      verb: filters.verb,
      actorId: filters.actorId,
      result: filters.result,
      ip: filters.ip,
      search: filters.search,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
    })) {
      if (value) params.set(key, value);
    }
    if (filters.showViews) params.set('views', 'all');
    if (overrides.live ?? autoRefresh) params.set('live', '1');
    const page = overrides.page ?? currentPage;
    if (page > 1) params.set('page', String(page));
    const suffix = params.toString();
    return suffix === '' ? pathname : `${pathname}?${suffix}`;
  }

  function goTo(page: number): void {
    setPageInput(String(page));
    router.push(queryFor({ page }));
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    setExportError('');
    try {
      const result = await exportAuditLog({
        entity: filters.entity || undefined,
        verb: filters.verb || undefined,
        actorId: filters.actorId || undefined,
        result: filters.result || undefined,
        ip: filters.ip || undefined,
        showViews: filters.showViews,
        search: filters.search || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
      });
      if (!result.success) {
        setExportError(result.error);
        return;
      }
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-export-${Date.now()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
        <span>{dict.pageInfo.replace('{total}', String(total))}</span>
        <div className="flex items-center gap-2">
          {/* Why an alert: the export failing is a state of the whole control, and a colour alone
              would be unreadable to a screen reader and invisible in high contrast. */}
          {exportError !== '' && (
            <InlineAlert tone="destructive" density="compact" announce="polite">
              {exportError}
            </InlineAlert>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => {
              router.replace(queryFor({ live: !autoRefresh }));
            }}
          >
            {dict.autoRefresh}
            {autoRefresh ? ' •' : ''}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            disabled={exporting}
            onClick={() => {
              void handleExport();
            }}
          >
            {exporting ? '…' : dict.exportCsv}
          </Button>
        </div>
      </div>
      {totalPages > 1 && (
        <TablePaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onPageGo={() => {
            const target = Number(pageInput) || 1;
            goTo(Math.max(1, Math.min(target, totalPages)));
          }}
          perPage={50}
          onPerPageChange={() => { /* the audit log is read at one page size */ }}
          onPrev={() => goTo(currentPage - 1)}
          onNext={() => goTo(currentPage + 1)}
        />
      )}
    </div>
  );
}