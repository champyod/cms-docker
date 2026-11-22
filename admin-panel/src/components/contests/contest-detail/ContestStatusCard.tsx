'use client';

import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2';
const FIELD_ERROR_CLASSES = 'border-destructive focus-visible:ring-destructive/20';
const ERROR_CLASSES = 'mt-1 text-xs text-destructive';

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

interface Props { formData: FormTiming; onChange: (patch: Partial<FormTiming>) => void; timeErrors: Record<string, string>; }

const TIME_FIELDS: ReadonlyArray<{ id: TimingField; label: string }> = [
  { id: 'start', label: 'Contest Start' },
  { id: 'stop', label: 'Contest Stop' },
  { id: 'analysis_start', label: 'Analysis Start' },
  { id: 'analysis_stop', label: 'Analysis Stop' },
];

/**
 * The four timings the overview edits, and nothing else.
 *
 * Why the phase badge and its heading left this card: the page's fact strip already answers which
 * state the contest is in, and the card had the same word twice on one screen. What stays is the
 * window the operator came here to change, each field carrying its own error.
 */
export function ContestStatusCard({ formData, onChange, timeErrors }: Props) {
  return (
    <Card className="p-4">
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
