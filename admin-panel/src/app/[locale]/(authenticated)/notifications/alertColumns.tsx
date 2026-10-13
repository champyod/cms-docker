import { resultBadgeVariant, truncate } from '@/components/audit/auditColumns';
import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { TimestampFormatter } from '@/components/layout/TimezoneProvider';
import type { AlertRow } from '@/lib/alert-history';
import type { Dictionary } from '@/lib/dictionary';

export type NotificationsCopy = Dictionary['notifications'];

// Why a dash and not a blank: an alert raised by the system has no actor, so the cell must read as
// "no actor" in both layouts rather than as a value that failed to render.
const MISSING_VALUE = '—';

// Why one column set drives both layouts: the desktop row and the mobile card render from this list,
// so the alert history cannot show different fields depending on the viewport.
export function buildAlertColumns(
  copy: NotificationsCopy,
  formatTimestamp: TimestampFormatter,
): ResponsiveColumn<AlertRow>[] {
  return [
    {
      key: 'timestamp',
      header: copy.columns.timestamp,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground md:whitespace-nowrap">
          {formatTimestamp(entry.timestamp)}
        </span>
      ),
    },
    { key: 'verb', header: copy.columns.verb, render: (entry) => <Badge variant="cyan">{entry.verb}</Badge> },
    {
      key: 'actor',
      header: copy.columns.actor,
      render: (entry) => (
        <span className="font-mono text-xs text-indigo-400">{entry.actor_name ?? MISSING_VALUE}</span>
      ),
    },
    {
      key: 'target',
      header: copy.columns.target,
      render: (entry) => (
        <span className="text-sm text-foreground">{truncate(entry.entity_name ?? entry.entity, 60)}</span>
      ),
    },
    {
      key: 'result',
      header: copy.columns.result,
      render: (entry) => <Badge variant={resultBadgeVariant(entry.result)}>{entry.result}</Badge>,
    },
  ];
}
