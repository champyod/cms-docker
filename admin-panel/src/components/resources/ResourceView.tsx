'use client';

import { useCallback, useRef, useState } from 'react';
import { WorkerNodeList } from '@/components/workers/WorkerNodeList';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';
import { GaugeCard } from '@/components/resources/GaugeCard';
import { Activity, Cpu, Database, Network } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { LiveIndicator } from '@/components/core/LiveIndicator';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useLiveStream } from '@/hooks/useLiveStream';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import { useDictionary } from '@/hooks/useDictionary';
import { TRAFFIC_LOG_LIMIT_DEFAULT } from '@/lib/constants/live-stream';
import type { ResourceFrame, ServerStats, TrafficLog, WorkerNodeView, CoreServiceStatus } from '@/lib/live-frames';
import type { Dictionary } from '@/lib/dictionary';
import { rowsFromNodes } from '@/lib/worker-nodes';

interface PendingFirstFrame {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Why null and not a word: the label says where the numbers came from, which is itself a claim. */
function sourceLabel(serverStats: ServerStats | null, dict: Dictionary): string | null {
  if (serverStats === null) return null;
  return serverStats.source === 'host' ? dict.resources.hostSource : dict.resources.containerSource;
}

// Why the network figures get their own label: their origin can differ from the CPU/RAM/uptime one when only one mount is present.
function networkSourceLabel(serverStats: ServerStats | null, dict: Dictionary): string | null {
  const network = serverStats?.network;
  if (!network) return null;
  return network.source === 'host' ? dict.resources.hostSource : dict.resources.containerSource;
}

export function ResourceView(): React.JSX.Element {
  const dict = useDictionary();
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [workers, setWorkers] = useState<WorkerNodeView[]>([]);
  const [services, setServices] = useState<CoreServiceStatus[] | null>(null);
  const [traffic, setTraffic] = useState<TrafficLog[] | null>(null);
  const [trafficLimit, setTrafficLimit] = useState<number>(TRAFFIC_LOG_LIMIT_DEFAULT);

  // Why every section is optional in the frame: a section is left out when this viewer may not read
  // it or when its probe failed, and the card must then keep the last reading it had rather than
  // blanking out. The same handler covers all four cards because they arrive on one connection.
  const applyFrame = useCallback((frame: ResourceFrame): void => {
    if (frame.server) setServerStats(frame.server);
    if (frame.workers) setWorkers(frame.workers);
    if (frame.services) setServices(frame.services);
    if (frame.traffic) setTraffic(frame.traffic);
  }, []);

  // Why the first frame is the load: a channel that never carries one has loaded nothing, and its
  // status is what tells the panel body apart from a spinner that would never clear. The connection's
  // own state still lives in useLiveStream; this is only whether the load ever finished.
  const pendingFirstFrame = useRef<PendingFirstFrame | null>(null);
  const load = useCallback((): Promise<void> => new Promise<void>((resolve, reject) => {
    pendingFirstFrame.current = { resolve, reject };
  }), []);
  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  const onFrame = useCallback((frame: ResourceFrame): void => {
    applyFrame(frame);
    pendingFirstFrame.current?.resolve();
    pendingFirstFrame.current = null;
  }, [applyFrame]);

  const onStreamError = useCallback((): void => {
    pendingFirstFrame.current?.reject(new Error('The resource stream did not open'));
    pendingFirstFrame.current = null;
  }, []);

  const { status: liveStatus, refresh } = useLiveStream<ResourceFrame>({
    url: `/api/resources/stream?trafficLimit=${trafficLimit}`,
    onFrame,
    onError: onStreamError,
  });

  const source = sourceLabel(serverStats, dict);

  // Why the indicator is published from here and withdrawn unless loaded: the stream status is this
  // hook's own, and the loading surface below replaces the panel body entirely.
  usePublishModuleActions(
    'infrastructure.resources',
    status.kind === 'idle' ? <LiveIndicator status={liveStatus} /> : null,
  );

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle={dict.resources.loading}
        onRetry={() => { reload(); refresh(); }}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  return (
    <div className="space-y-4 density:space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Why "not here yet" is not "nothing to read": the summary section arrives later. */}
          <CoreServicesStatus services={services ?? []} loading={services === null} />

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
          <WorkerNodeList
            rows={rowsFromNodes(workers)}
            emptyTitle="No worker nodes found"
            emptyDescription="Workers are globally shared and configured in Infrastructure → Deployments"
          />
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div>
            <div className="flex items-center gap-2 text-foreground mb-4">
              <Network className="w-5 h-5 text-info" />
              <h2 className="text-xl font-bold">{dict.resources.systemMetrics}</h2>
            </div>
            <MetricsCard serverStats={serverStats} />
          </div>
            <NetworkTrafficLogs logs={traffic ?? []} limit={trafficLimit} onLimitChange={setTrafficLimit} loading={traffic === null} />
        </div>
    </div>
  );
}

export function MetricsCard({ serverStats }: { serverStats: ServerStats | null }): React.JSX.Element {
  const dict = useDictionary();
  const networkSource = networkSourceLabel(serverStats, dict);
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
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {dict.resources.networkTotal}{networkSource === null ? '' : ` ${networkSource}`}
            </div>
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
