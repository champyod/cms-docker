'use client';

import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

export interface GaugeCardProps {
  icon: React.ReactNode;
  label: string;
  source: string | null;
  percent: number;
  tone: 'auto' | 'info';
  /**
   * What the cell around the gauge needs the card to carry.
   *
   * Why the gauge takes a class from its caller at all: the freshness cue wraps the figure in an
   * element of its own, and that wrapper — not the card — becomes the grid cell, so the card has to
   * fill it (`h-full`) instead of stretching as the cell itself. The gauge's own sizing stays here.
   */
  className?: string;
}

/** Single percentage gauge card (CPU/RAM); thresholds live here, not per page. */
export function GaugeCard({ icon, label, source, percent, tone, className }: GaugeCardProps): React.JSX.Element {
  const bar = tone === 'info' ? 'bg-info' : percent > 80 ? 'bg-destructive' : percent > 50 ? 'bg-warning' : 'bg-primary';
  return (
    <Card
      className={cn(
        'p-6 density:p-4 flex flex-col justify-center items-center text-center space-y-4 density:gap-2',
        className,
      )}
    >
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
