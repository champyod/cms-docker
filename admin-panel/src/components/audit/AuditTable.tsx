'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLiveStream } from '@/hooks/useLiveStream';
import type { AuditCursorFrame } from '@/lib/live/frames';
import type { ListSortInput } from '@/lib/list-sorting';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { getAuditEntry } from '@/app/actions/audit';
import type { AuditDetailRow } from '@/app/actions/audit';
import { Filter } from 'lucide-react';
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

/** This component owns the one thing only it knows: which row the reader opened. */
export function AuditTable({
  entries,
  dict,
  missing,
  sort,
  autoRefresh = false,
}: AuditTableProps): React.JSX.Element {
  const router = useAppRouter();
  // Why the hook and not window.location.pathname: it hands back the path with the base path stripped.
  const pathname = usePathname();

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AuditDetailRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const latestAuditIdRef = useRef<string | null>(null);

  // The rows on screen are this page's own query, so a new row is only visible through the reload the stream triggers.
  const onAuditFrame = useCallback(
    (frame: AuditCursorFrame): void => {
      if (latestAuditIdRef.current === frame.latestId) return;
      latestAuditIdRef.current = frame.latestId;
      router.refresh();
    },
    [router],
  );

  // The stream's status reports the push channel, not the rows; the rows say whether the read succeeded.
  useLiveStream<AuditCursorFrame>({
    url: '/api/audit/stream',
    onFrame: onAuditFrame,
    enabled: autoRefresh,
  });

  const applySort = useCallback((next: ListSortInput): void => {
    const params = new URLSearchParams(window.location.search);
    if (next !== null && next !== undefined) {
      params.set('sort', next.key);
      params.set('dir', next.direction);
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    params.set('page', '1');
    const query = params.toString();
    router.replace(query.length > 0 ? `?${query}` : pathname);
  }, [router, pathname]);

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
      // Only transport-level rejections reach here, and they must still clear the spinner.
      setDetailError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setLoadingDetail(false);
    }
  };

  // One column definition drives the desktop rows and the mobile cards, so the two layouts cannot drift.
  const columns = useMemo(
    () => buildAuditColumns(dict, { formatTimestamp, truncate, resultBadgeVariant }, missing),
    [dict, missing],
  );

  const { getRowProps, renderRowActions } = createAuditRowRenderers(expandedRowId, handleRowClick);

  const expandedEntry = expandedRowId === null
    ? undefined
    : entries.find((entry) => entry.id === expandedRowId);

  return (
    <div className="space-y-4">
      <ResponsiveTable
        columns={columns}
        rows={entries}
        getRowKey={(entry) => entry.id}
        getRowProps={getRowProps}
        renderRowActions={renderRowActions}
        actionsHeader={<span className="sr-only">{dict.expandedDetails}</span>}
        sort={sort}
        onSortChange={applySort}
        emptyState={<EmptyState icon={Filter} title={dict.noEntries} />}
      />

      <AuditDetailPanel
        entry={expandedEntry}
        missing={missing}
        dict={dict}
        loading={loadingDetail}
        error={detailError}
        detail={expandedDetail}
        onClose={() => {
          if (expandedRowId !== null) void handleRowClick(expandedRowId);
        }}
      />
    </div>
  );
}
