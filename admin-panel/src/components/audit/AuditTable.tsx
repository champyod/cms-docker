'use client';

import { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import { useAppRouter } from '@/hooks/useAppRouter';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { getAuditEntry, getDistinctEntities } from '@/app/actions/audit';
import type { AuditDetailRow } from '@/app/actions/audit';
import { Filter } from 'lucide-react';
import { AuditFilters } from './AuditFilters';
import { AuditToolbar } from './AuditToolbar';
import { AuditDetailPanel } from './AuditDetailPanel';
import { createAuditRowRenderers } from './auditRowRenderers';
import {
  buildAuditColumns,
  formatTimestamp,
  truncate,
  resultBadgeVariant,
} from './auditColumns';
import type { AuditTableProps } from './auditTypes';

export type { AuditTableProps } from './auditTypes';

export function AuditTable({
  entries,
  total,
  totalPages,
  currentPage,
  filters,
  dict,
}: AuditTableProps): React.JSX.Element {
  const router = useAppRouter();
  const [isPending, startTransition] = useTransition();

  const [entityFilter, setEntityFilter] = useState(filters.entity ?? '');
  const [verbFilter, setVerbFilter] = useState(filters.verb ?? '');
  const [actorIdFilter, setActorIdFilter] = useState(filters.actorId ?? '');
  const [resultFilter, setResultFilter] = useState(filters.result ?? '');
  const [searchFilter, setSearchFilter] = useState(filters.search ?? '');
  const [fromDateFilter, setFromDateFilter] = useState(filters.fromDate ?? '');
  const [toDateFilter, setToDateFilter] = useState(filters.toDate ?? '');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AuditDetailRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [entities, setEntities] = useState<string[]>([]);
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, router]);

  useEffect(() => {
    void (async () => {
      const result = await getDistinctEntities();
      if (result.success) setEntities(result.data);
    })();
  }, []);

  const navigateWithFilters = useCallback(
    (overrides?: Record<string, string>) => {
      const params = new URLSearchParams();
      const merged = {
        entity: entityFilter,
        verb: verbFilter,
        actorId: actorIdFilter,
        result: resultFilter,
        search: searchFilter,
        fromDate: fromDateFilter,
        toDate: toDateFilter,
        ...overrides,
      };
      for (const [key, val] of Object.entries(merged)) {
        if (val) params.set(key, val);
      }
      params.set('page', overrides?.page ?? '1');
      startTransition(() => {
        router.push(`?${params.toString()}`);
      });
    },
    [entityFilter, verbFilter, actorIdFilter, resultFilter, searchFilter, fromDateFilter, toDateFilter, router],
  );

  const handleApplyFilters = () => navigateWithFilters();
  const handleClearFilters = () => {
    setEntityFilter('');
    setVerbFilter('');
    setActorIdFilter('');
    setResultFilter('');
    setSearchFilter('');
    setFromDateFilter('');
    setToDateFilter('');
    startTransition(() => {
      router.push('?');
    });
  };

  const handlePageChange = (newPage: number) => {
    setPageInput(String(newPage));
    navigateWithFilters({ page: String(newPage) });
  };

  const handleRowClick = async (id: string) => {
    if (expandedRowId === id) {
      setExpandedRowId(null);
      setExpandedDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedRowId(id);
    setExpandedDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const result = await getAuditEntry(Number(id));
      if (result.success) {
        setExpandedDetail(result.data);
      } else {
        setDetailError(result.error);
      }
    } catch (error) {
      // The action body reports failures via the result; only transport-level
      // rejections reach here, and they must still clear the spinner.
      setDetailError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(
    () => buildAuditColumns(dict, { formatTimestamp, truncate, resultBadgeVariant }),
    [dict],
  );

  const { getRowProps, renderRowActions } = createAuditRowRenderers(expandedRowId, handleRowClick);

  const expandedEntry = expandedRowId === null
    ? undefined
    : entries.find((entry) => entry.id === expandedRowId);

  return (
    <div className="space-y-4">
      <AuditFilters
        dict={dict}
        entities={entities}
        entityFilter={entityFilter}
        verbFilter={verbFilter}
        actorIdFilter={actorIdFilter}
        resultFilter={resultFilter}
        searchFilter={searchFilter}
        fromDateFilter={fromDateFilter}
        toDateFilter={toDateFilter}
        onEntityFilter={setEntityFilter}
        onVerbFilter={setVerbFilter}
        onActorIdFilter={setActorIdFilter}
        onResultFilter={setResultFilter}
        onSearchFilter={setSearchFilter}
        onFromDateFilter={setFromDateFilter}
        onToDateFilter={setToDateFilter}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
      />

      <AuditToolbar
        dict={dict}
        total={total}
        isPending={isPending}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        filters={{
          entity: entityFilter,
          verb: verbFilter,
          actorId: actorIdFilter,
          result: resultFilter,
          search: searchFilter,
          fromDate: fromDateFilter,
          toDate: toDateFilter,
        }}
      />

      <ResponsiveTable
        columns={columns}
        rows={entries}
        getRowKey={(entry) => entry.id}
        getRowProps={getRowProps}
        renderRowActions={renderRowActions}
        actionsHeader={<span className="sr-only">{dict.expandedDetails}</span>}
        emptyState={<EmptyState icon={Filter} title={dict.noEntries} />}
      />

      <AuditDetailPanel
        entry={expandedEntry}
        dict={dict}
        loading={loadingDetail}
        error={detailError}
        detail={expandedDetail}
        onClose={() => {
          if (expandedRowId !== null) void handleRowClick(expandedRowId);
        }}
      />

      {totalPages > 1 && (
        <TablePaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onPageGo={() => {
            const target = Number(pageInput) || 1;
            const clamped = Math.max(1, Math.min(target, totalPages));
            handlePageChange(clamped);
          }}
          perPage={50}
          onPerPageChange={() => { /* page size is fixed at 50 for audit */ }}
          onPrev={() => handlePageChange(currentPage - 1)}
          onNext={() => handlePageChange(currentPage + 1)}
        />
      )}
    </div>
  );
}
