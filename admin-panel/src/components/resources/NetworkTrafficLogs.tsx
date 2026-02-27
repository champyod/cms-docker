'use client';

import { useState, useEffect } from 'react';
import { getNetworkTrafficLogs } from '@/app/actions/docker-ops';
import { Card } from '@/components/core/Card';
import { Network, Filter } from 'lucide-react';

export function NetworkTrafficLogs() {
  const [logs, setLogs] = useState<any[]>([]);
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
    <Card className="glass-card border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <Network className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Network Traffic</h2>
            <p className="text-xs text-neutral-500">Real-time container network I/O</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-neutral-500" />
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-black/40 border border-white/10 rounded-lg text-white text-xs outline-none focus:border-cyan-500/50"
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
            <tr className="border-b border-white/5 text-neutral-500 text-xs">
              <th className="text-left py-2 px-3 font-medium">Container</th>
              <th className="text-right py-2 px-3 font-medium">RX (Download)</th>
              <th className="text-right py-2 px-3 font-medium">TX (Upload)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-neutral-500">
                  Loading traffic data...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-neutral-500">
                  No traffic data available
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2 px-3 font-mono text-xs text-neutral-300">{log.container}</td>
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
