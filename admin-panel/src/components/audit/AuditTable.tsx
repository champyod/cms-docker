'use client';

import { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import { useAppRouter } from '@/hooks/useAppRouter';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import {
  ResponsiveTable,
  type ResponsiveRowProps,
} from '@/components/core/ResponsiveTable';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { getAuditEntry, getDistinctEntities } from '@/app/actions/audit';
import type { AuditLogRow, AuditDetailRow } from '@/app/actions/audit';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { AuditFilters } from './AuditFilters';
import { AuditToolbar } from './AuditToolbar';
import { AuditDetailContent } from './AuditDetail';
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
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
    const result = await getAuditEntry(Number(id));
    setLoadingDetail(false);
    if (result.success) {
      setExpandedDetail(result.data);
    } else {
      setDetailError(result.error);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(
    () => buildAuditColumns(dict, { formatTimestamp, truncate, resultBadgeVariant }),
    [dict],
  );

  const getRowProps = (entry: AuditLogRow): ResponsiveRowProps => ({
    onClick: () => {
      void handleRowClick(entry.id);
    },
    className: 'cursor-pointer',
    'aria-expanded': expandedRowId === entry.id,
  });

  // Why: shared by desktop rows and mobile cards, with 44px targets kept
  // in this fragment so both layouts stay touch-sized.
  const renderRowActions = (entry: AuditLogRow) => {
    const isExpanded = expandedRowId === entry.id;
    return (
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={`Toggle details for ${entry.verb} on ${entry.entity}`}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={(e) => {
          e.stopPropagation();
          void handleRowClick(entry.id);
        }}
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
    );
  };

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

      {expandedEntry !== undefined && (loadingDetail || expandedDetail !== null || detailError !== null) && (
        <Card className="p-4 space-y-4">
          {loadingDetail && (
            <div className="text-sm text-muted-foreground animate-pulse">Loading details…</div>
          )}
          {detailError !== null && (
            <div className="text-sm text-destructive">
              {dict.detailLoadFailed}: {detailError}
            </div>
          )}
          {expandedDetail && (
            <AuditDetailContent
              detail={expandedDetail}
              dict={dict}
              copiedField={copiedField}
              onCopy={(text, field) => {
                void handleCopy(text, field);
              }}
            />
          )}
        </Card>
      )}

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
