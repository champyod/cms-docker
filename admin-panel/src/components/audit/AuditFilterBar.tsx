'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';

import { getDistinctEntities } from '@/app/actions/audit';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';

import { AuditFilters } from './AuditFilters';
import type { AuditDict, AuditFilterValues } from './auditTypes';

export interface AuditFilterBarProps {
  readonly dict: AuditDict;
  /** The narrowing the request carried: the controls start from it, so a reload keeps the filter. */
  readonly initial: AuditFilterValues;
}

/**
 * The audit log's filters, owned by the page so the list layout can put them above the rows.
 *
 * WHY the values live here and not in the table: a filter and a page number are part of the
 * request, so the controls select the next address and the server re-reads the log. The table then
 * only renders the rows it was handed, which is what keeps its row order the server's order.
 */
export function AuditFilterBar({ dict, initial }: AuditFilterBarProps): React.JSX.Element {
  const router = useAppRouter();
  // Why the hook and not window.location.pathname: it hands back the path with the base path stripped.
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [entity, setEntity] = useState(initial.entity ?? '');
  const [verb, setVerb] = useState(initial.verb ?? '');
  const [actorId, setActorId] = useState(initial.actorId ?? '');
  const [result, setResult] = useState(initial.result ?? '');
  const [ip, setIp] = useState(initial.ip ?? '');
  const [showViews, setShowViews] = useState(initial.showViews ?? false);
  const [search, setSearch] = useState(initial.search ?? '');
  const [fromDate, setFromDate] = useState(initial.fromDate ?? '');
  const [toDate, setToDate] = useState(initial.toDate ?? '');
  const [entities, setEntities] = useState<string[]>([]);

  // The entity list is the distinct values the log already holds, so it is read once per mount
  // rather than per keystroke: it narrows the choice, it does not narrow the rows.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const read = await getDistinctEntities();
      if (!cancelled && read.success) setEntities(read.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = useCallback(
    (overrides?: Record<string, string>) => {
      const params = new URLSearchParams();
      const merged = {
        entity,
        verb,
        actorId,
        result,
        ip,
        search,
        fromDate,
        toDate,
        ...overrides,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value) params.set(key, value);
      }
      if (showViews) params.set('views', 'all');
      params.set('page', overrides?.page ?? '1');
      startTransition(() => {
        router.push(`?${params.toString()}`);
      });
    },
    [entity, verb, actorId, result, ip, showViews, search, fromDate, toDate, router],
  );

  const applySearch = useDebouncedSearch({
    value: search,
    delayMs: 300,
    onApply: (applied) => navigate({ search: applied }),
  });

  const clear = (): void => {
    setEntity('');
    setVerb('');
    setActorId('');
    setResult('');
    setIp('');
    setShowViews(false);
    setSearch('');
    setFromDate('');
    setToDate('');
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="w-full space-y-1">
      <AuditFilters
        dict={dict}
        entities={entities}
        entityFilter={entity}
        verbFilter={verb}
        actorIdFilter={actorId}
        resultFilter={result}
        ipFilter={ip}
        showViews={showViews}
        searchFilter={search}
        fromDateFilter={fromDate}
        toDateFilter={toDate}
        onEntityFilter={setEntity}
        onVerbFilter={setVerb}
        onActorIdFilter={setActorId}
        onResultFilter={setResult}
        onIpFilter={setIp}
        onShowViews={setShowViews}
        onSearchFilter={setSearch}
        onFromDateFilter={setFromDate}
        onToDateFilter={setToDate}
        onApply={() => applySearch(search)}
        onClear={clear}
      />
      {isPending && <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>}
    </div>
  );
}
