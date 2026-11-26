'use client';

import { Card } from '@/components/core/Card';
import { Badge } from '@/components/core/Badge';
import { resolveContestPhase } from '@/lib/contest-countdown';
import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
const FIELD_ERROR_CLASSES = 'border-destructive focus-visible:ring-destructive/20';
const ERROR_CLASSES = 'mt-1 text-xs text-destructive';

interface ContestTiming { start: string | Date | null; stop: string | Date | null; analysis_start: string | Date | null; analysis_stop: string | Date | null; }

interface FormTiming { start: string; stop: string; analysis_start: string; analysis_stop: string; }

type TimingField = keyof FormTiming;

interface TimeFieldProps {
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}

/** The zone error is the thrown message verbatim — it names the zone, the jump, or both instants. */
function TimeField({ label, value, error, onChange }: TimeFieldProps) {
  return (
    <div>
      <label className={LABEL_CLASSES}>{label}</label>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD_CLASSES, error !== undefined && FIELD_ERROR_CLASSES)}
      />
      {error !== undefined && <p className={ERROR_CLASSES}>{error}</p>}
    </div>
  );
}

type StatusVariant = 'neutral' | 'success' | 'info' | 'destructive';

function getStatus(contest: ContestTiming): { label: string; variant: StatusVariant; pulsing: boolean } {
  switch (resolveContestPhase(contest, new Date())) {
    case 'not_started': return { label: 'Not Started', variant: 'neutral', pulsing: false };
    case 'running': return { label: 'Running', variant: 'success', pulsing: true };
    case 'analysis': return { label: 'Analysis Mode', variant: 'info', pulsing: false };
    case 'ended': return { label: 'Ended', variant: 'destructive', pulsing: false };
  }
}

function StatusBadge({ contest }: { contest: ContestTiming }) {
  const status = getStatus(contest);
  return (
    <Badge variant={status.variant} className={status.pulsing ? 'animate-pulse' : undefined}>
      {status.label}
    </Badge>
  );
}

interface Props { contest: ContestTiming; formData: FormTiming; onChange: (patch: Partial<FormTiming>) => void; timeErrors: Record<string, string>; }

const TIME_FIELDS: ReadonlyArray<{ id: TimingField; label: string }> = [
  { id: 'start', label: 'Contest Start' },
  { id: 'stop', label: 'Contest Stop' },
  { id: 'analysis_start', label: 'Analysis Start' },
  { id: 'analysis_stop', label: 'Analysis Stop' },
];

export function ContestStatusCard({ contest, formData, onChange, timeErrors }: Props) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-warning" />
          <span className="font-bold text-foreground">Contest Status</span>
        </div>
        <StatusBadge contest={contest} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {TIME_FIELDS.map(({ id, label }) => (
          <TimeField
            key={id}
            label={label}
            value={formData[id]}
            error={timeErrors[id]}
            onChange={(value) => onChange({ [id]: value })}
          />
        ))}
      </div>
    </Card>
  );
}
