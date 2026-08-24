'use client';

import { useState, useEffect } from 'react';
import { getNetworkTrafficLogs } from '@/app/actions/docker-ops';
import { Card } from '@/components/core/Card';
import { SkeletonText } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import { Network, Filter, Activity } from 'lucide-react';

interface TrafficLog {
  id: number;
  timestamp: string;
  container: string;
  rx: string;
  tx: string;
}

export function NetworkTrafficLogs() {
  const [logs, setLogs] = useState<TrafficLog[]>([]);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const result = await getNetworkTrafficLogs(limit);
      if (result.success) {
        setLogs(result.logs);
      }
    } catch (error) {
      console.error('Failed to fetch network logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [limit]);

  return (
    <Card className="p-6">
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
            onChange={(e) => setLimit(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs outline-none focus:border-cyan-500/50"
          >
            <option value={10}>Last 10</option>
            <option value={20}>Last 20</option>
            <option value={30}>Last 30</option>
            <option value={50}>Last 50</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left py-2 px-3 font-medium">Container</th>
              <th className="text-right py-2 px-3 font-medium">RX (Download)</th>
              <th className="text-right py-2 px-3 font-medium">TX (Upload)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="py-6 px-3">
                  <SkeletonText lines={2} />
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8">
                  <EmptyState icon={Activity} title="No traffic data available" />
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="py-2 px-3 font-mono text-xs text-foreground">{log.container}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-emerald-400">{log.rx}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-indigo-400">{log.tx}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
