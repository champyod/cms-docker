'use client';

import { useState } from 'react';
import {
  TableCell,
  TableRow,
} from '@/components/core/Table';
import { Badge } from '@/components/core/Badge';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import type { AuditLogRow, AuditDetailRow } from '@/app/actions/audit';
import type { AuditDict } from './audit-dict';

interface AuditRowProps {
  entry: AuditLogRow;
  isExpanded: boolean;
  expandedDetail: AuditDetailRow | null;
  loadingDetail: boolean;
  onRowClick: (id: string) => void;
  dict: AuditDict;
}

/** One audit row plus its expandable before/after detail. */
export function AuditRow({
  entry,
  isExpanded,
  expandedDetail,
  loadingDetail,
  onRowClick,
  dict,
}: AuditRowProps): React.JSX.Element {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const formatTimestamp = (iso: string): string => new Date(iso).toLocaleString();

  const truncate = (text: string | null, max: number): string => {
    if (!text) return '—';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const resultBadgeVariant = (result: string): 'success' | 'destructive' | 'neutral' => {
    if (result === 'success') return 'success';
    if (result === 'failure') return 'destructive';
    return 'neutral';
  };

  const handleCopy = async (text: string, field: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
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
    <>
      <TableRow
        className="border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => onRowClick(entry.id)}
      >
        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {formatTimestamp(entry.timestamp)}
        </TableCell>
        <TableCell className="font-mono text-xs text-indigo-400">
          {entry.actor_name ?? (entry.actor_id !== null ? `#${entry.actor_id}` : '—')}
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
        <TableCell className="text-sm text-muted-foreground max-w-50">
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
                      <span className="font-mono text-xs text-foreground truncate max-w-60">
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
