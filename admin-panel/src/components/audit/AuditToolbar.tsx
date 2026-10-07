'use client';

import { useState } from 'react';
import { Button } from '@/components/core/Button';
import { Download, RefreshCw } from 'lucide-react';
import { exportAuditLog } from '@/app/actions/audit-export';
import type { AuditDict } from './audit-dict';

export interface AuditToolbarFilters {
  entity?: string;
  verb?: string;
  actorId?: string;
  result?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

interface AuditToolbarProps {
  dict: AuditDict;
  total: number;
  isPending: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  filters: AuditToolbarFilters;
}

/** Result count, auto-refresh toggle and audited CSV export for the audit log. */
export function AuditToolbar({
  dict,
  total,
  isPending,
  autoRefresh,
  onToggleAutoRefresh,
  filters,
}: AuditToolbarProps): React.JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    setExportError('');
    try {
      const result = await exportAuditLog({
        entity: filters.entity || undefined,
        verb: filters.verb || undefined,
        actorId: filters.actorId || undefined,
        result: filters.result || undefined,
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
  };

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
      <span>{dict.pageInfo.replace('{total}', String(total))}</span>
      <div className="flex items-center gap-2">
        {exportError && <span className="text-xs text-destructive">{exportError}</span>}
        {isPending && <span className="animate-pulse">Loading…</span>}
        <Button variant="ghost" size="sm" onClick={onToggleAutoRefresh} icon={RefreshCw}>
          {dict.autoRefresh}{autoRefresh ? ' •' : ''}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { void handleExport(); }} disabled={exporting} icon={Download}>
          {exporting ? '…' : dict.exportCsv}
        </Button>
      </div>
    </div>
  );
}
