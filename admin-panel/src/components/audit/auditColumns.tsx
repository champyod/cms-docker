import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { AuditLogRow } from '@/app/actions/audit';
import type { AuditDict } from './auditTypes';

export interface AuditColumnHelpers {
  formatTimestamp: (iso: string) => string;
  truncate: (text: string | null, max: number) => string;
  resultBadgeVariant: (result: string) => 'success' | 'destructive' | 'neutral';
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function truncate(text: string | null, max: number): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function resultBadgeVariant(result: string): 'success' | 'destructive' | 'neutral' {
  if (result === 'success') return 'success';
  if (result === 'failure') return 'destructive';
  return 'neutral';
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
export function buildAuditColumns(
  dict: AuditDict,
  helpers: AuditColumnHelpers,
): ResponsiveColumn<AuditLogRow>[] {
  return [
    {
      key: 'timestamp',
      header: dict.columns.timestamp,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {helpers.formatTimestamp(entry.timestamp)}
        </span>
      ),
    },
    {
      key: 'actor',
      header: dict.columns.actor,
      render: (entry) => (
        <span className="font-mono text-xs text-indigo-400">
          {entry.actor_id !== null ? `#${entry.actor_id}` : '—'}
        </span>
      ),
    },
    {
      key: 'verb',
      header: dict.columns.verb,
      render: (entry) => <Badge variant="cyan">{entry.verb}</Badge>,
    },
    {
      key: 'entity',
      header: dict.columns.entity,
      render: (entry) => <span className="text-sm text-foreground">{entry.entity}</span>,
    },
    {
      key: 'entityId',
      header: dict.columns.entityId,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">{entry.entity_id ?? '—'}</span>
      ),
    },
    {
      key: 'result',
      header: dict.columns.result,
      render: (entry) => (
        <Badge variant={helpers.resultBadgeVariant(entry.result)}>{entry.result}</Badge>
      ),
    },
    {
      key: 'reason',
      header: dict.columns.reason,
      render: (entry) => (
        <span className="block max-w-[200px] text-sm text-muted-foreground">
          {helpers.truncate(entry.reason, 60)}
        </span>
      ),
    },
  ];
}
