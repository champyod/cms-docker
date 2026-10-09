'use client';

import { useCallback, useState } from 'react';
import { WorkerGrid } from '@/components/resources/WorkerGrid';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';
import { GaugeCard } from '@/components/resources/GaugeCard';
import { Activity, Cpu, Database, Network } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { LiveIndicator } from '@/components/core/LiveIndicator';
import { SurfaceState } from '@/components/core/SurfaceState';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useDictionary } from '@/hooks/useDictionary';
import { TRAFFIC_LOG_LIMIT_DEFAULT } from '@/lib/constants/live-stream';
import type { ResourceFrame, ServerStats, TrafficLog, WorkerStat, CoreServiceStatus } from '@/lib/live-frames';

export function ResourceView(): React.JSX.Element {
  const dict = useDictionary();
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [workers, setWorkers] = useState<WorkerStat[]>([]);
  const [services, setServices] = useState<CoreServiceStatus[]>([]);
  const [traffic, setTraffic] = useState<TrafficLog[]>([]);
  const [trafficLimit, setTrafficLimit] = useState<number>(TRAFFIC_LOG_LIMIT_DEFAULT);
  const [loading, setLoading] = useState(true);

  // Why every section is optional in the frame: a section is left out when this viewer may not read
  // it or when its probe failed, and the card must then keep the last reading it had rather than
  // blanking out. The same handler covers all four cards because they arrive on one connection.
  const onFrame = useCallback((frame: ResourceFrame): void => {
    if (frame.server) setServerStats(frame.server);
    if (frame.workers) setWorkers(frame.workers);
    if (frame.services) setServices(frame.services);
    if (frame.traffic) setTraffic(frame.traffic);
    setLoading(false);
  }, []);

  const { status } = useLiveStream<ResourceFrame>({
    url: `/api/resources/stream?trafficLimit=${trafficLimit}`,
    onFrame,
  });

  const source = serverStats?.source === 'host' ? dict.resources.hostSource : dict.resources.containerSource;
  const awaitingFirstFrame = loading && !serverStats;

  // Why the indicator is published from here and withdrawn while loading: the stream status
  // is this hook's own, and the loading surface below replaces the panel body entirely.
  usePublishModuleActions(
    'infrastructure.resources',
    awaitingFirstFrame ? null : <LiveIndicator status={status} />,
  );

  if (awaitingFirstFrame) {
    return <SurfaceState status={{ kind: 'loading', title: dict.resources.loading }} />;
  }

  return (
    <div className="space-y-4 density:space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CoreServicesStatus services={services} loading={loading} />

          <GaugeCard
            icon={<Cpu className="w-4 h-4 text-primary" />}
            label={dict.resources.cpuUsage}
            source={source}
            percent={serverStats?.cpu || 0}
            tone="auto"
          />

          <GaugeCard
            icon={<Database className="w-4 h-4 text-info" />}
            label={dict.resources.memoryUsage}
            source={source}
            percent={serverStats?.memory || 0}
            tone="info"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-foreground">
              <Activity className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold">{dict.resources.workerNodes}</h2>
          </div>
          <WorkerGrid workers={workers} />
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div>
            <div className="flex items-center gap-2 text-foreground mb-4">
              <Network className="w-5 h-5 text-info" />
              <h2 className="text-xl font-bold">{dict.resources.systemMetrics}</h2>
            </div>
            <MetricsCard serverStats={serverStats} />
          </div>
          <NetworkTrafficLogs logs={traffic} limit={trafficLimit} onLimitChange={setTrafficLimit} loading={loading} />
        </div>
    </div>
  );
}

export function MetricsCard({ serverStats }: { serverStats: ServerStats | null }): React.JSX.Element {
  const dict = useDictionary();
  return (
    <div className="grid grid-cols-1 gap-6">
      <Card className="p-4 density:p-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{dict.resources.uptime}</div>
            <div className="text-lg font-mono text-foreground">{serverStats?.uptime || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{dict.resources.loadAvg}</div>
            <div className="text-lg font-mono text-foreground">{serverStats?.loadAvg?.[0] || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{dict.resources.networkTotal}</div>
            <div className="text-xs font-mono text-success">
              {serverStats?.network ? `↓ ${formatBytes(serverStats.network.rx)}` : '-'}
            </div>
            <div className="text-xs font-mono text-primary">
              {serverStats?.network ? `↑ ${formatBytes(serverStats.network.tx)}` : '-'}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
