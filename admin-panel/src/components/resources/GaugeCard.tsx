'use client';

import { Card } from '@/components/core/Card';

export interface GaugeCardProps {
  icon: React.ReactNode;
  label: string;
  source: string | null;
  percent: number;
  tone: 'auto' | 'info';
}

/** Single percentage gauge card (CPU/RAM); thresholds live here, not per page. */
export function GaugeCard({ icon, label, source, percent, tone }: GaugeCardProps): React.JSX.Element {
  const bar = tone === 'info' ? 'bg-cyan-500' : percent > 80 ? 'bg-red-500' : percent > 50 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <Card className="p-6 density:p-4 flex flex-col justify-center items-center text-center space-y-4 density:gap-2">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {label} {source === null ? '' : source}
        </span>
      </div>
      <div className="text-4xl density:text-3xl font-bold text-foreground font-mono">{percent}%</div>
      <div className="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-1000 ${bar}`} style={{ width: `${percent}%` }} />
      </div>
    </Card>
  );
}
