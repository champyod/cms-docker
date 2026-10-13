'use client';

import { useState } from 'react';

import { useAppRouter } from '@/hooks/useAppRouter';
import type { AlertRow } from '@/lib/alert-history';
import { buildRoute } from '@/lib/navigation/routes';
import { AlertFiltersBar, type AlertCentreFilters } from './AlertFiltersBar';
import { AlertHistoryTable } from './AlertHistoryTable';
import { AlertLiveTail } from './AlertLiveTail';
import type { NotificationsCopy } from './alertColumns';

interface AlertCentreProps {
  readonly locale: string;
  readonly copy: NotificationsCopy;
  readonly entries: AlertRow[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly pageSize: number;
  readonly filters: AlertCentreFilters;
}

/**
 * The audit log has no per-row URL, so a record is reached through the filters that name it.
 *
 * Why the verb and the entity together: the log's verb filter matches a substring while the entity
 * filter is exact, and the pair narrows the page to the alert's own row.
 */
function auditRecordHref(auditLogHref: string, entry: AlertRow): string {
  return `${auditLogHref}?entity=${encodeURIComponent(entry.entity)}&verb=${encodeURIComponent(entry.verb)}`;
}

/**
 * The alert centre: the live tail, the filter card and the paged history, all over one route.
 *
 * Why the filters travel in the query: the history is read on the server, so a filter has to reach
 * the page's own searchParams rather than filter rows this component already holds.
 */
export function AlertCentre({
  locale,
  copy,
  entries,
  total,
  totalPages,
  currentPage,
  pageSize,
  filters,
}: AlertCentreProps): React.JSX.Element {
  const router = useAppRouter();
  const [search, setSearch] = useState(filters.search ?? '');
  const [result, setResult] = useState(filters.result ?? '');
  const [fromDate, setFromDate] = useState(filters.fromDate ?? '');
  const [toDate, setToDate] = useState(filters.toDate ?? '');
  const [pageInput, setPageInput] = useState(String(currentPage));
  const auditLogHref = buildRoute(locale, 'administration.audit');

  const navigate = (overrides: Readonly<Record<string, string>>): void => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ search, result, fromDate, toDate, ...overrides })) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `?${query}` : '?');
  };

  const changePage = (page: number): void => {
    setPageInput(String(page));
    navigate({ page: String(page) });
  };

  const clearFilters = (): void => {
    setSearch('');
    setResult('');
    setFromDate('');
    setToDate('');
    router.push('?');
  };

  return (
    <div className="space-y-4">
      <AlertLiveTail copy={copy} auditLogHref={auditLogHref} />
      <AlertFiltersBar
        copy={copy}
        search={search}
        result={result}
        fromDate={fromDate}
        toDate={toDate}
        onSearch={setSearch}
        onResult={setResult}
        onFromDate={setFromDate}
        onToDate={setToDate}
        onApply={() => navigate({ page: '1' })}
        onClear={clearFilters}
      />
      <AlertHistoryTable
        copy={copy}
        entries={entries}
        total={total}
        totalPages={totalPages}
        currentPage={currentPage}
        pageSize={pageSize}
        recordHref={(entry) => auditRecordHref(auditLogHref, entry)}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onPageChange={changePage}
      />
    </div>
  );
}
