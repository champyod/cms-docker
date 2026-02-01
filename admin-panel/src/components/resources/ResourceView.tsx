'use client';

import { useState, useEffect } from 'react';
import { getServerStats, getWorkerStats } from '@/app/actions/stats';
import { WorkerGrid } from '@/components/resources/WorkerGrid';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';
import { Activity, Server, ShieldCheck, Clock, Cpu, Database, Network } from 'lucide-react';
import { Card } from '@/components/core/Card';

export function ResourceView() {
  const [serverStats, setServerStats] = useState<any>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [sStats, wStats] = await Promise.all([
        getServerStats(),
        getWorkerStats()
      ]);
      setServerStats(sStats);
      setWorkers(wStats);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Polling every 5s
    return () => clearInterval(interval);
  }, []);

  if (loading && !serverStats) {
    return <div className="text-white">Loading system metrics...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CoreServicesStatus />

          <Card className="p-6 glass-card border-white/5 flex flex-col justify-center items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-indigo-400 mb-2">
                <Cpu className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">CPU Usage</span>
            </div>
            <div className="text-4xl font-bold text-white font-mono">{serverStats?.cpu || 0}%</div>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-1000 ${
                        (serverStats?.cpu || 0) > 80 ? 'bg-red-500' : (serverStats?.cpu || 0) > 50 ? 'bg-amber-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${serverStats?.cpu || 0}%` }} 
                />
            </div>
          </Card>

           <Card className="p-6 glass-card border-white/5 flex flex-col justify-center items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-cyan-400 mb-2">
                <Database className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">RAM Usage</span>
            </div>
            <div className="text-4xl font-bold text-white font-mono">{serverStats?.memory || 0}%</div>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-cyan-500 transition-all duration-1000" 
                    style={{ width: `${serverStats?.memory || 0}%` }} 
                />
            </div>
          </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-white">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h2 className="text-xl font-bold">Worker Nodes</h2>
        </div>
        <WorkerGrid workers={workers} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div>
          <div className="flex items-center gap-2 text-white mb-4">
            <Network className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold">System Metrics</h2>
          </div>
          <div className="grid grid-cols-1 gap-6">
            <Card className="p-4 glass-card border-white/5">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Uptime</div>
                  <div className="text-lg font-mono text-white">{serverStats?.uptime || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Load Avg</div>
                  <div className="text-lg font-mono text-white">{serverStats?.loadAvg?.[0] || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Network Total</div>
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
        <NetworkTrafficLogs />
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
