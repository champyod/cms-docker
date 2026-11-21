'use client';

import { Card } from '@/components/core/Card';
import { SkeletonText } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import { RowFreshness } from '@/components/core/RowFreshness';
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from '@/components/core/ResponsiveTable';
import { Network, Filter, Activity } from 'lucide-react';
import { TRAFFIC_LOG_LIMIT_OPTIONS } from '@/lib/constants/live-stream';
import type { RowFreshnessInput } from '@/lib/live/row-freshness';
import type { TrafficLog } from '@/lib/live-frames';

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
const TRAFFIC_COLUMNS: ResponsiveColumn<TrafficLog>[] = [
  {
    key: 'container',
    header: 'Container',
    cellClassName: 'py-2 density:py-1 px-3',
    render: (log) => <span className="font-mono text-xs">{log.container}</span>,
  },
  {
    key: 'rx',
    header: <span className="block text-right">RX (Download)</span>,
    mobileLabel: 'RX',
    cellClassName: 'py-2 density:py-1 px-3',
    render: (log) => (
      <span className="block text-right font-mono text-xs text-success">{log.rx}</span>
    ),
  },
  {
    key: 'tx',
    header: <span className="block text-right">TX (Upload)</span>,
    mobileLabel: 'TX',
    cellClassName: 'py-2 density:py-1 px-3',
    render: (log) => (
      <span className="block text-right font-mono text-xs text-primary">{log.tx}</span>
    ),
  },
];

function TrafficTable({ logs }: { logs: TrafficLog[] }): React.JSX.Element {
  return (
    <ResponsiveTable
      columns={TRAFFIC_COLUMNS}
      rows={logs}
      getRowKey={(log) => log.id}
      emptyState={<EmptyState icon={Activity} title="No traffic data available" />}
    />
  );
}

function TrafficHeader({ limit, onLimitChange }: { limit: number; onLimitChange: (value: number) => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-info/10">
          <Network className="w-5 h-5 text-info" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Network Traffic</h2>
          <p className="text-xs text-muted-foreground">Real-time container network I/O</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={limit}
          onChange={(e) => onLimitChange(parseInt(e.target.value))}
          className="px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs outline-none focus:border-info/50"
        >
          {TRAFFIC_LOG_LIMIT_OPTIONS.map((option) => (
            <option key={option} value={option}>Last {option}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Why the cue wraps the table and not each row: the rows of one read share one instant, and a table
 * row is a `<tr>`, which the cue's wrapper element cannot sit inside without breaking the table.
 * Marking the region says what a per-row mark would say, in the one place the wrapper is valid.
 */
function TrafficBody({ logs, loading, freshness }: { logs: TrafficLog[]; loading: boolean; freshness?: RowFreshnessInput }): React.JSX.Element {
  if (loading) return <SkeletonText lines={2} />;
  if (logs.length === 0) return <EmptyState icon={Activity} title="No traffic data available" />;
  const table = <TrafficTable logs={logs} />;
  return freshness === undefined ? table : <RowFreshness {...freshness}>{table}</RowFreshness>;
}

interface NetworkTrafficLogsProps {
  logs: TrafficLog[];
  limit: number;
  onLimitChange: (value: number) => void;
  loading: boolean;
  /**
   * How current the table is, when the surface that owns it is fed by a stream that dates its reads.
   * One entry for the whole table: the rows arrive from a single read, so every row's read instant is
   * the table's. A surface with no such stream passes nothing, and the table renders exactly as before.
   */
  freshness?: RowFreshnessInput;
}

/**
 * Why the page size is a prop: it is part of the stream's address, so changing it reopens the
 * connection with the new size instead of starting a request of its own.
 */
export function NetworkTrafficLogs({ logs, limit, onLimitChange, loading, freshness }: NetworkTrafficLogsProps): React.JSX.Element {
  return (
    <Card className="p-6">
      <TrafficHeader limit={limit} onLimitChange={onLimitChange} />
      <TrafficBody logs={logs} loading={loading} freshness={freshness} />
    </Card>
  );
}
