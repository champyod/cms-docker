'use client';

import { Card } from '@/components/core/Card';
import { Badge } from '@/components/core/Badge';
import { Zap } from 'lucide-react';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface ContestTiming { start: string | Date | null; stop: string | Date | null; analysis_start: string | Date | null; analysis_stop: string | Date | null; }

interface FormTiming { start: string; stop: string; analysis_start: string; analysis_stop: string; }

type StatusVariant = 'neutral' | 'success' | 'info' | 'destructive';

function getStatus(contest: ContestTiming): { label: string; variant: StatusVariant; pulsing: boolean } {
  const now = new Date();
  const start = contest.start ? new Date(contest.start) : null;
  const stop = contest.stop ? new Date(contest.stop) : null;
  const analysisStart = contest.analysis_start ? new Date(contest.analysis_start) : null;
  const analysisStop = contest.analysis_stop ? new Date(contest.analysis_stop) : null;
  if (!start || now < start) return { label: 'Not Started', variant: 'neutral', pulsing: false };
  if (stop && now < stop) return { label: 'Running', variant: 'success', pulsing: true };
  if (analysisStart && analysisStop && now >= analysisStart && now < analysisStop) return { label: 'Analysis Mode', variant: 'info', pulsing: false };
  return { label: 'Ended', variant: 'destructive', pulsing: false };
}

function StatusBadge({ contest }: { contest: ContestTiming }) {
  const status = getStatus(contest);
  return (
    <Badge variant={status.variant} className={status.pulsing ? 'animate-pulse' : undefined}>
      {status.label}
    </Badge>
  );
}

interface Props { contest: ContestTiming; formData: FormTiming; onChange: (patch: Partial<FormTiming>) => void; }

export function ContestStatusCard({ contest, formData, onChange }: Props) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-warning" />
          <span className="font-bold text-foreground">Contest Status</span>
        </div>
        <StatusBadge contest={contest} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label className={LABEL_CLASSES}>Contest Start</label>
          <input type="datetime-local" value={formData.start} onChange={(e) => onChange({ start: e.target.value })} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Contest Stop</label>
          <input type="datetime-local" value={formData.stop} onChange={(e) => onChange({ stop: e.target.value })} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Analysis Start</label>
          <input type="datetime-local" value={formData.analysis_start} onChange={(e) => onChange({ analysis_start: e.target.value })} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Analysis Stop</label>
          <input type="datetime-local" value={formData.analysis_stop} onChange={(e) => onChange({ analysis_stop: e.target.value })} className={FIELD_CLASSES} />
        </div>
      </div>
    </Card>
  );
}
