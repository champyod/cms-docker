'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Activity, Server, Cpu, Database, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface WorkerStats {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  cpu: number;
  memory: number;
  tasks: number;
  uptime: string;
}

export function WorkerGrid() {
  const [workers, setWorkers] = useState<WorkerStats[]>([
    { id: '1', name: 'worker-01', status: 'online', cpu: 12, memory: 45, tasks: 124, uptime: '2d 4h' },
    { id: '2', name: 'worker-02', status: 'busy', cpu: 88, memory: 72, tasks: 452, uptime: '5d 1h' },
    { id: '3', name: 'worker-03', status: 'online', cpu: 5, memory: 38, tasks: 89, uptime: '12h 30m' },
    { id: '4', name: 'worker-04', status: 'offline', cpu: 0, memory: 0, tasks: 0, uptime: '0m' },
  ]);

  // Simulate live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setWorkers(prev => prev.map(w => {
        if (w.status === 'offline') return w;
        return {
          ...w,
          cpu: Math.max(2, Math.min(99, w.cpu + (Math.random() * 20 - 10))),
          memory: Math.max(30, Math.min(95, w.memory + (Math.random() * 4 - 2))),
        };
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {workers.map((worker) => (
        <Card key={worker.id} className="p-6 glass-card border-white/5 space-y-4 hover:border-white/20 transition-all group">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Server className="w-5 h-5" />
            </div>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              worker.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' :
              worker.status === 'busy' ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                worker.status === 'online' ? 'bg-emerald-500 animate-pulse' :
                worker.status === 'busy' ? 'bg-amber-500 animate-bounce' :
                'bg-red-500'
              }`} />
              {worker.status}
            </div>
          </div>

          <div>
            <h3 className="font-bold text-white text-lg">{worker.name}</h3>
            <p className="text-xs text-neutral-500 font-mono">ID: {worker.id}</p>
          </div>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                <span>CPU Usage</span>
                <span className="text-neutral-300">{Math.round(worker.cpu)}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ${
                    worker.cpu > 80 ? 'bg-red-500' : worker.cpu > 50 ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${worker.cpu}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                <span>Memory usage</span>
                <span className="text-neutral-300">{Math.round(worker.memory)}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-500 transition-all duration-1000"
                  style={{ width: `${worker.memory}%` }}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-between items-center text-xs text-neutral-500 border-t border-white/5">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>{worker.tasks} tasks</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{worker.uptime}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
