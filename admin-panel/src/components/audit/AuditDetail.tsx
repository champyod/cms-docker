'use client';

import { Copy, Check } from 'lucide-react';
import type { AuditDetailRow } from '@/app/actions/audit';
import type { AuditDict } from './auditTypes';

interface AuditDetailContentProps {
  detail: AuditDetailRow;
  dict: AuditDict;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}

interface AuditJsonValueProps {
  value: unknown;
  label: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}

export function AuditJsonValue({ value, label, copiedField, onCopy }: AuditJsonValueProps): React.JSX.Element {
  const formatted = value ? JSON.stringify(value, null, 2) : 'null';
  return (
    <div className="relative group">
      <pre className="bg-muted/60 rounded-lg p-4 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap break-all text-foreground border border-border">
        {formatted}
      </pre>
      <button
        type="button"
        onClick={() => onCopy(formatted, label)}
        className="absolute top-2 right-2 p-1 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label={`Copy ${label}`}
      >
        {copiedField === label ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

export function AuditDetailContent({ detail, dict, copiedField, onCopy }: AuditDetailContentProps): React.JSX.Element {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">{dict.ip}: </span>
          <span className="font-mono text-foreground">{detail.ip ?? '—'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{dict.sessionId}: </span>
          <span className="font-mono text-foreground">{detail.session_id ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{dict.entryHash}: </span>
          <span className="font-mono text-xs text-foreground truncate max-w-[240px]">
            {detail.entry_hash ?? '—'}
          </span>
          {detail.entry_hash && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopy(detail.entry_hash ?? '', 'hash');
              }}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Copy entry hash"
            >
              <Copy className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {detail.reason && (
        <div className="text-sm">
          <span className="text-muted-foreground">{dict.columns.reason}: </span>
          <span className="text-foreground">{detail.reason}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            {dict.beforeValues}
          </h4>
          <AuditJsonValue value={detail.before_values} label="before" copiedField={copiedField} onCopy={onCopy} />
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            {dict.afterValues}
          </h4>
          <AuditJsonValue value={detail.after_values} label="after" copiedField={copiedField} onCopy={onCopy} />
        </div>
      </div>
    </>
  );
}
