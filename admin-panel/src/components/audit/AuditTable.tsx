'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Card } from '@/components/core/Card';
import { Badge } from '@/components/core/Badge';
import { EmptyState } from '@/components/core/EmptyState';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { getAuditEntry, getDistinctEntities } from '@/app/actions/audit';
import type { AuditLogRow, AuditDetailRow } from '@/app/actions/audit';
import { Search, Filter, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface AuditDict {
  title: string;
  subtitle: string;
  columns: {
    timestamp: string;
    actor: string;
    verb: string;
    entity: string;
    entityId: string;
    result: string;
    reason: string;
  };
  filters: {
    entity: string;
    verb: string;
    actorId: string;
    fromDate: string;
    toDate: string;
    apply: string;
    clear: string;
    allEntities: string;
  };
  noEntries: string;
  pageInfo: string;
  expandedDetails: string;
  beforeValues: string;
  afterValues: string;
  ip: string;
  sessionId: string;
  entryHash: string;
  prevHash: string;
}

interface AuditTableProps {
  entries: AuditLogRow[];
  total: number;
  totalPages: number;
  currentPage: number;
  filters: {
    entity?: string;
    verb?: string;
    actorId?: string;
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
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [entityFilter, setEntityFilter] = useState(filters.entity ?? '');
  const [verbFilter, setVerbFilter] = useState(filters.verb ?? '');
  const [actorIdFilter, setActorIdFilter] = useState(filters.actorId ?? '');
  const [fromDateFilter, setFromDateFilter] = useState(filters.fromDate ?? '');
  const [toDateFilter, setToDateFilter] = useState(filters.toDate ?? '');

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AuditDetailRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [entities, setEntities] = useState<string[]>([]);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
    [entityFilter, verbFilter, actorIdFilter, fromDateFilter, toDateFilter, router],
  );

  const handleApplyFilters = () => navigateWithFilters();
  const handleClearFilters = () => {
    setEntityFilter('');
    setVerbFilter('');
    setActorIdFilter('');
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

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const formatTimestamp = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  const truncate = (text: string | null, max: number): string => {
    if (!text) return '—';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const resultBadgeVariant = (result: string): 'success' | 'destructive' | 'neutral' => {
    if (result === 'success') return 'success';
    if (result === 'failure') return 'destructive';
    return 'neutral';
  };

  const renderJsonValue = (value: unknown, label: string): React.JSX.Element => {
    const formatted = value ? JSON.stringify(value, null, 2) : 'null';
    return (
      <div className="relative group">
        <pre className="bg-muted/60 rounded-lg p-4 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap break-all text-foreground border border-border">
          {formatted}
        </pre>
        <button
          type="button"
          onClick={() => handleCopy(formatted, label)}
          className="absolute top-2 right-2 p-1 rounded bg-muted opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          {copiedField === label ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">{dict.filters.entity}</label>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              title={dict.filters.entity}
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value="">{dict.filters.allEntities}</option>
              {entities.map((ent) => (
                <option key={ent} value={ent}>{ent}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <Input
              label={dict.filters.verb}
              value={verbFilter}
              onChange={(e) => setVerbFilter(e.target.value)}
              placeholder={dict.filters.verb}
            />
          </div>
          <div className="min-w-[120px]">
            <Input
              label={dict.filters.actorId}
              value={actorIdFilter}
              onChange={(e) => setActorIdFilter(e.target.value)}
              placeholder="ID"
            />
          </div>
          <div className="min-w-[160px]">
            <Input
              label={dict.filters.fromDate}
              type="date"
              value={fromDateFilter}
              onChange={(e) => setFromDateFilter(e.target.value)}
            />
          </div>
          <div className="min-w-[160px]">
            <Input
              label={dict.filters.toDate}
              type="date"
              value={toDateFilter}
              onChange={(e) => setToDateFilter(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <Button variant="positive" size="sm" onClick={handleApplyFilters} icon={Search}>
              {dict.filters.apply}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              {dict.filters.clear}
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
        <span>{dict.pageInfo.replace('{total}', String(total))}</span>
        {isPending && <span className="animate-pulse">Loading…</span>}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Filter} title={dict.noEntries} />
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card/50">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-muted-foreground w-[180px]">{dict.columns.timestamp}</TableHead>
                <TableHead className="text-muted-foreground w-[80px]">{dict.columns.actor}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.verb}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.entity}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.entityId}</TableHead>
                <TableHead className="text-muted-foreground w-[100px]">{dict.columns.result}</TableHead>
                <TableHead className="text-muted-foreground">{dict.columns.reason}</TableHead>
                <TableHead className="text-muted-foreground w-[40px]" />
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
                    formatTimestamp={formatTimestamp}
                    truncate={truncate}
                    resultBadgeVariant={resultBadgeVariant}
                    renderJsonValue={renderJsonValue}
                    dict={dict}
                    copiedField={copiedField}
                    handleCopy={handleCopy}
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

interface AuditRowProps {
  entry: AuditLogRow;
  isExpanded: boolean;
  expandedDetail: AuditDetailRow | null;
  loadingDetail: boolean;
  onRowClick: (id: string) => void;
  formatTimestamp: (iso: string) => string;
  truncate: (text: string | null, max: number) => string;
  resultBadgeVariant: (result: string) => 'success' | 'destructive' | 'neutral';
  renderJsonValue: (value: unknown, label: string) => React.JSX.Element;
  dict: AuditDict;
  copiedField: string | null;
  handleCopy: (text: string, field: string) => void;
}

function AuditRow({
  entry,
  isExpanded,
  expandedDetail,
  loadingDetail,
  onRowClick,
  formatTimestamp,
  truncate,
  resultBadgeVariant,
  renderJsonValue,
  dict,
  handleCopy,
}: AuditRowProps): React.JSX.Element {
  return (
    <>
      <TableRow
        className="border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => onRowClick(entry.id)}
      >
        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {formatTimestamp(entry.timestamp)}
        </TableCell>
        <TableCell className="font-mono text-xs text-indigo-400">
          {entry.actor_id !== null ? `#${entry.actor_id}` : '—'}
        </TableCell>
        <TableCell>
          <Badge variant="cyan">{entry.verb}</Badge>
        </TableCell>
        <TableCell className="text-sm text-foreground">{entry.entity}</TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {entry.entity_id ?? '—'}
        </TableCell>
        <TableCell>
          <Badge variant={resultBadgeVariant(entry.result)}>{entry.result}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-[200px]">
          {truncate(entry.reason, 60)}
        </TableCell>
        <TableCell>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-muted/30 border-b border-border">
          <TableCell colSpan={8} className="p-0">
            <div className="p-4 space-y-4">
              {loadingDetail && (
                <div className="text-sm text-muted-foreground animate-pulse">Loading details…</div>
              )}
              {expandedDetail && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">{dict.ip}: </span>
                      <span className="font-mono text-foreground">{expandedDetail.ip ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{dict.sessionId}: </span>
                      <span className="font-mono text-foreground">{expandedDetail.session_id ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{dict.entryHash}: </span>
                      <span className="font-mono text-xs text-foreground truncate max-w-[240px]">
                        {expandedDetail.entry_hash ?? '—'}
                      </span>
                      {expandedDetail.entry_hash && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopy(expandedDetail.entry_hash ?? '', 'hash');
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="Copy entry hash"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedDetail.reason && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">{dict.columns.reason}: </span>
                      <span className="text-foreground">{expandedDetail.reason}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        {dict.beforeValues}
                      </h4>
                      {renderJsonValue(expandedDetail.before_values, 'before')}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        {dict.afterValues}
                      </h4>
                      {renderJsonValue(expandedDetail.after_values, 'after')}
                    </div>
                  </div>
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
