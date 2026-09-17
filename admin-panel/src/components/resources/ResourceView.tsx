'use client';

import { useCallback, useState } from 'react';
import { WorkerGrid } from '@/components/resources/WorkerGrid';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';
import { Activity, Cpu, Database, Network } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { LiveIndicator } from '@/components/core/LiveIndicator';
import { useLiveStream } from '@/hooks/useLiveStream';
import { TRAFFIC_LOG_LIMIT_DEFAULT } from '@/lib/constants/live-stream';
import type { CoreServiceStatus, ResourceFrame, ServerStats, TrafficLog, WorkerStat } from '@/lib/live-frames';

export function ResourceView(): React.JSX.Element {
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

  if (loading && !serverStats) {
    return <div className="text-muted-foreground">Loading system metrics...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <LiveIndicator status={status} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CoreServicesStatus services={services} loading={loading} />

          <Card className="p-6 flex flex-col justify-center items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-indigo-400 mb-2">
                <Cpu className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">CPU Usage {serverStats?.source === 'host' ? '(Host)' : '(Container)'}</span>
            </div>
            <div className="text-4xl font-bold text-foreground font-mono">{serverStats?.cpu || 0}%</div>
            <div className="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-1000 ${
                        (serverStats?.cpu || 0) > 80 ? 'bg-red-500' : (serverStats?.cpu || 0) > 50 ? 'bg-amber-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${serverStats?.cpu || 0}%` }} 
                />
            </div>
          </Card>

           <Card className="p-6 flex flex-col justify-center items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-cyan-400 mb-2">
                <Database className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">RAM Usage {serverStats?.source === 'host' ? '(Host)' : '(Container)'}</span>
            </div>
            <div className="text-4xl font-bold text-foreground font-mono">{serverStats?.memory || 0}%</div>
            <div className="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-cyan-500 transition-all duration-1000" 
                    style={{ width: `${serverStats?.memory || 0}%` }} 
                />
            </div>
          </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-foreground">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h2 className="text-xl font-bold">Worker Nodes</h2>
        </div>
        <WorkerGrid workers={workers} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div>
          <div className="flex items-center gap-2 text-foreground mb-4">
            <Network className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold">System Metrics</h2>
          </div>
          <div className="grid grid-cols-1 gap-6">
            <Card className="p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-center">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Uptime</div>
                  <div className="text-lg font-mono text-foreground">{serverStats?.uptime || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Load Avg</div>
                  <div className="text-lg font-mono text-foreground">{serverStats?.loadAvg?.[0] || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Network Total</div>
                  <div className="text-xs font-mono text-emerald-400">
                    {serverStats?.network ? `↓ ${formatBytes(serverStats.network.rx)}` : '-'}
                  </div>
                  <div className="text-xs font-mono text-indigo-400">
                    {serverStats?.network ? `↑ ${formatBytes(serverStats.network.tx)}` : '-'}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
        <NetworkTrafficLogs logs={traffic} limit={trafficLimit} onLimitChange={setTrafficLimit} loading={loading} />
      </div>
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
