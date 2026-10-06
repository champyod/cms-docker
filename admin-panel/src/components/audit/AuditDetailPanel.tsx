'use client';

import { useState } from 'react';
import { SidePanel } from '@/components/core/SidePanel';
import { toast } from 'sonner';
import type { AuditLogRow, AuditDetailRow } from '@/app/actions/audit';
import { AuditDetailContent } from './AuditDetail';
import type { AuditDict } from './auditTypes';

const COPY_FEEDBACK_DURATION_MS = 1500;

interface AuditDetailPanelProps {
  entry: AuditLogRow | undefined;
  dict: AuditDict;
  loading: boolean;
  error: string | null;
  detail: AuditDetailRow | null;
  onClose: () => void;
}

export function AuditDetailPanel({
  entry,
  dict,
  loading,
  error,
  detail,
  onClose,
}: AuditDetailPanelProps): React.JSX.Element {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error('Copy failed. Select the text to copy it manually.');
      return;
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), COPY_FEEDBACK_DURATION_MS);
  };

  // Why a side panel and not a block under the table: an entry's detail is
  // read against the rows above it, and a block below pushed the row the
  // reader clicked off the screen on every open.
  return (
    <SidePanel
      open={entry !== undefined && (loading || detail !== null || error !== null)}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
      title={entry === undefined ? dict.expandedDetails : `${entry.verb} · ${entry.entity_name ?? entry.entity}`}
    >
      {loading && <div className="text-sm text-muted-foreground animate-pulse">Loading details…</div>}
      {error !== null && (
        <div className="text-sm text-destructive">
          {dict.detailLoadFailed}: {error}
        </div>
      )}
      {detail && (
        <AuditDetailContent
          detail={detail}
          dict={dict}
          copiedField={copiedField}
          onCopy={(text, field) => {
            void handleCopy(text, field);
          }}
        />
      )}
    </SidePanel>
  );
}
