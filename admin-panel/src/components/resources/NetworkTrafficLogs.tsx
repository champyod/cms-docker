'use client';

import { Card } from '@/components/core/Card';
import { SkeletonText } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from '@/components/core/ResponsiveTable';
import { Network, Filter, Activity } from 'lucide-react';
import { TRAFFIC_LOG_LIMIT_OPTIONS } from '@/lib/constants/live-stream';
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
      <span className="block text-right font-mono text-xs text-emerald-400">{log.rx}</span>
    ),
  },
  {
    key: 'tx',
    header: <span className="block text-right">TX (Upload)</span>,
    mobileLabel: 'TX',
    cellClassName: 'py-2 density:py-1 px-3',
    render: (log) => (
      <span className="block text-right font-mono text-xs text-indigo-400">{log.tx}</span>
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
        <div className="p-2 rounded-lg bg-cyan-500/10">
          <Network className="w-5 h-5 text-cyan-400" />
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
          className="px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs outline-none focus:border-cyan-500/50"
        >
          {TRAFFIC_LOG_LIMIT_OPTIONS.map((option) => (
            <option key={option} value={option}>Last {option}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TrafficBody({ logs, loading }: { logs: TrafficLog[]; loading: boolean }): React.JSX.Element {
  if (loading) return <SkeletonText lines={2} />;
  if (logs.length === 0) return <EmptyState icon={Activity} title="No traffic data available" />;
  return <TrafficTable logs={logs} />;
}

interface NetworkTrafficLogsProps {
  logs: TrafficLog[];
  limit: number;
  onLimitChange: (value: number) => void;
  loading: boolean;
}

/**
 * Why the page size is a prop: it is part of the stream's address, so changing it reopens the
 * connection with the new size instead of starting a request of its own.
 */
export function NetworkTrafficLogs({ logs, limit, onLimitChange, loading }: NetworkTrafficLogsProps): React.JSX.Element {
  return (
    <Card className="p-6">
      <TrafficHeader limit={limit} onLimitChange={onLimitChange} />
      <TrafficBody logs={logs} loading={loading} />
    </Card>
  );
}
