'use client';

import {
  Server,
  Cpu
} from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { StatusPill, statusTone } from '@/components/core/StatusPill';
import type { WorkerStat } from '@/lib/live-frames';

const ICON_TONE: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-400',
  blue: 'bg-blue-500/10 text-blue-400',
  red: 'bg-red-500/10 text-red-400',
};

export function WorkerGrid({ workers }: { workers: WorkerStat[] }) {
  if (!workers || workers.length === 0) {
    return (
      <Card className="p-8">
        <EmptyState
          icon={Server}
          title="No worker nodes found"
          description="Workers are globally shared and configured in Infrastructure → Deployments"
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {workers.map((worker) => (
        <Card
          key={worker.id}
          className="p-5 density:p-3 hover:border-primary/30 transition-all group min-w-0"
        >
          <div className="flex justify-between items-start gap-2 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2 rounded-lg shrink-0 ${ICON_TONE[statusTone(worker.status)]}`}>
                <Server className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3
                  title={worker.name}
                  className="text-sm font-bold text-foreground group-hover:text-indigo-400 transition-colors truncate"
                >
                  {worker.name}
                </h3>
                <span className="block text-xs text-muted-foreground font-mono uppercase tracking-wider truncate">
                  {worker.id}
                </span>
              </div>
            </div>
            <StatusPill status={worker.status} className="shrink-0" />
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground font-bold uppercase tracking-widest">
                <div className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  Task Load
                </div>
                <span>{worker.load}%</span>
              </div>
              <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    worker.load > 80 ? 'bg-red-500' : worker.load > 50 ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${worker.load}%` }}
                />
              </div>
            </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-bold uppercase tracking-widest truncate">
              {worker.tasks > 0 ? `${worker.tasks} tasks` : 'no tasks'} · {worker.activity} · {worker.health}
            </span>
            <span className="font-mono shrink-0">{worker.load}%</span>
          </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
