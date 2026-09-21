'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { EmptyState } from '@/components/core/EmptyState';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { getAuditEntry, getDistinctEntities } from '@/app/actions/audit';
import type { AuditLogRow, AuditDetailRow } from '@/app/actions/audit';
import { Filter } from 'lucide-react';
import { AuditFilters } from './AuditFilters';
import { AuditRow } from './AuditRow';
import { AuditToolbar } from './AuditToolbar';
import type { AuditDict } from './audit-dict';

interface AuditTableProps {
  entries: AuditLogRow[];
  total: number;
  totalPages: number;
  currentPage: number;
  filters: {
    entity?: string;
    verb?: string;
    actorId?: string;
    result?: string;
    search?: string;
    fromDate?: string;
    toDate?: string;
  };
  dict: AuditDict;
  permissionKeys: string[];
}

export function AuditTable({
  entries,
  total,
  totalPages,
  currentPage,
  filters,
  dict,
}: AuditTableProps): React.JSX.Element {
  const router = useRouter();
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
      return;
    }
    setExpandedRowId(id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    const result = await getAuditEntry(Number(id));
    setLoadingDetail(false);
    if (result.success) {
      setExpandedDetail(result.data);
    }
  };

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

      {entries.length === 0 ? (
        <EmptyState icon={Filter} title={dict.noEntries} />
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card/50">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-muted-foreground w-45">{dict.columns.timestamp}</TableHead>
                <TableHead className="text-muted-foreground w-20">{dict.columns.actor}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.verb}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.entity}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.entityId}</TableHead>
                <TableHead className="text-muted-foreground w-25">{dict.columns.result}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.reason}</TableHead>
                <TableHead className="text-muted-foreground w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const isExpanded = expandedRowId === entry.id;
                return (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    isExpanded={isExpanded}
                    expandedDetail={isExpanded ? expandedDetail : null}
                    loadingDetail={isExpanded && loadingDetail}
                    onRowClick={handleRowClick}
                    dict={dict}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
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
