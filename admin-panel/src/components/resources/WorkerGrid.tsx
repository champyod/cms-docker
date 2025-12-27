'use client';

import {
  Server,
  Cpu,
  Database,
  CheckCircle2,
  AlertCircle,
  Clock
} from 'lucide-react';
import { Card } from '@/components/core/Card';

interface WorkerStats {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  load: number;
  tasks: number;
}

export function WorkerGrid({ workers }: { workers: WorkerStats[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {workers.map((worker) => (
        <Card
          key={worker.id}
          className="p-5 glass-card border-white/5 hover:border-indigo-500/30 transition-all group"
        >
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${worker.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' :
                  worker.status === 'busy' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'
                }`}>
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">
                  {worker.name}
                </h3>
                <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
                  {worker.id}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${worker.status === 'online' ? 'bg-emerald-500' :
                  worker.status === 'busy' ? 'bg-amber-500' : 
                'bg-red-500'
              }`} />
              <span className="text-[10px] font-bold text-neutral-400 uppercase">
                {worker.status}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-neutral-400 font-bold uppercase tracking-widest">
                <div className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  Task Load
                </div>
                <span>{worker.load}%</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ${
                    worker.load > 80 ? 'bg-red-500' : worker.load > 50 ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${worker.load}%` }} 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest leading-tight">
                  Active Tasks
                </span>
                <span className="text-sm font-bold text-white font-mono">
                  {worker.tasks}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest leading-tight">
                  Status
                </span>
                <div className="flex items-center gap-1">
                  {worker.tasks > 0 ? (
                    <Clock className="w-3 h-3 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  )}
                  <span className={`text-[10px] font-bold ${worker.tasks > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {worker.tasks > 0 ? 'Busy' : 'Idle'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
