'use client';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { LimitField } from '@/components/core/LimitField';
import { useDictionary } from '@/hooks/useDictionary';
import { normalizeNonNegativeInt } from '@/lib/limits';
import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
import type { ContestFormData, ContestLimitField, SetContestForm } from '../types';

interface LimitsTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
}

interface LimitRow {
  readonly name: ContestLimitField;
  readonly unit?: string;
}

/** The limit family this tab owns, in reading order: the token caps belong to the tokens tab. */
const LIMIT_ROWS: readonly LimitRow[] = [
  { name: 'max_submission_number' },
  { name: 'max_user_test_number' },
  { name: 'min_submission_interval', unit: 'sec' },
  { name: 'min_user_test_interval', unit: 'sec' },
  { name: 'per_user_time', unit: 'sec' },
  { name: 'min_submission_interval_grace_period', unit: 'sec' },
];

/**
 * Why the patch is typed out: a computed key over a union of field names would widen the object
 * and the strict form type would refuse it, while this partial is exactly the write it performs.
 */
function writeLimit(
  name: ContestLimitField,
  next: number | null,
  formData: ContestFormData,
  setFormData: SetContestForm
): void {
  const patch: Partial<Record<ContestLimitField, number | null>> = { [name]: next };
  setFormData({ ...formData, ...patch });
}

function QueueFairnessField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Queue Fairness Penalty (sec)</label>
      <input
        type="number"
        min={0}
        title="Queue Fairness Penalty (seconds)"
        placeholder="0"
        value={formData.queue_fairness_penalty_seconds}
        onChange={(e) => setFormData({ ...formData, queue_fairness_penalty_seconds: Math.max(0, parseInt(e.target.value) || 0) })}
        className={fieldClasses(validationErrors.has('queue_fairness_penalty_seconds'))}
      />
      <p className="text-xs text-muted-foreground">0 disables fairness delay. Formula: submission time + n × seconds.</p>
      <ErrorText errors={validationErrors} field="queue_fairness_penalty_seconds" />
    </div>
  );
}

/**
 * A column of the throttle family that nothing consumes yet: the operator can read the schema and its
 * stored value, but the control is disabled, so it can never write a knob that changes nothing.
 */
function ReservedField({ name, label, value, toggle = false }: {
  readonly name: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly toggle?: boolean;
}) {
  const reserved = useDictionary().limits.throttle.reserved;
  return (
    <div className="space-y-2 opacity-60" data-field={name}>
      <label htmlFor={name} className={LABEL_CLASSES}>{label}</label>
      {toggle ? (
        <input id={name} type="checkbox" checked={value === true} disabled aria-describedby={`${name}-reserved`} className="h-4 w-4" />
      ) : (
        <input id={name} type="text" value={String(value)} disabled aria-describedby={`${name}-reserved`} className={fieldClasses(false)} />
      )}
      <p id={`${name}-reserved`} className="text-xs text-muted-foreground">{reserved}</p>
    </div>
  );
}

/**
 * The evaluation-throttle family. Why on this tab and not a Throttle tab of its own: the delay's
 * meaning is defined by what it falls back to — the legacy Queue Fairness Penalty that already sits
 * here — so the resolution chain reads top to bottom on one screen instead of split across two.
 */
function ThrottleSection({ formData, setFormData, validationErrors }: LimitsTabProps) {
  const throttle = useDictionary().limits.throttle;
  return (
    <div className="space-y-4 rounded-lg border border-border p-4 md:col-span-2">
      <p className="text-sm font-bold text-foreground">{throttle.title}</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* The one consumed column: 0 means "no throttle delay of my own", so it is kept as a 0. */}
        <div className="space-y-2" data-field="evaluation_throttle_delay_s">
          <label htmlFor="evaluation_throttle_delay_s" className={LABEL_CLASSES}>{throttle.delayLabel} (sec)</label>
          <input
            id="evaluation_throttle_delay_s"
            type="number"
            min={0}
            step={1}
            value={formData.evaluation_throttle_delay_s}
            onChange={(e) => setFormData({ ...formData, evaluation_throttle_delay_s: normalizeNonNegativeInt(e.target.value) ?? 0 })}
            className={fieldClasses(validationErrors.has('evaluation_throttle_delay_s'))}
          />
          <p className="text-xs text-muted-foreground">{throttle.delayHint}</p>
          <ErrorText errors={validationErrors} field="evaluation_throttle_delay_s" />
        </div>
        <ReservedField name="evaluation_throttle_window_s" label={throttle.windowLabel} value={formData.evaluation_throttle_window_s} />
        <ReservedField name="evaluation_throttle_max" label={throttle.maxLabel} value={formData.evaluation_throttle_max} />
        <ReservedField name="evaluation_final_open" label={throttle.finalOpenLabel} value={formData.evaluation_final_open} toggle />
        <ReservedField name="evaluation_final_open_at" label={throttle.finalOpenAtLabel} value={formData.evaluation_final_open_at} />
      </div>
    </div>
  );
}

function ScorePrecisionField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Score Precision (decimals)</label>
      <input
        type="number"
        value={formData.score_precision}
        onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })}
        className={fieldClasses(validationErrors.has('score_precision'))}
      />
      <ErrorText errors={validationErrors} field="score_precision" />
    </div>
  );
}

export function LimitsTab({ formData, setFormData, validationErrors }: LimitsTabProps) {
  const limits = useDictionary().limits;
  // Why the cast to a partial: the label map covers every name in the family, the hint map only
  // the fields that need explaining.
  const hints: Partial<Record<ContestLimitField, string>> = limits.hints;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {LIMIT_ROWS.map((row) => (
          <LimitField
            key={row.name}
            id={row.name}
            label={limits.fields[row.name]}
            unit={row.unit}
            hint={hints[row.name]}
            value={formData[row.name]}
            onChangeValue={(next) => writeLimit(row.name, next, formData, setFormData)}
            error={validationErrors.get(row.name)}
            unlimitedLabel={limits.unlimited}
          />
        ))}
        {/* Above the legacy penalty so the delay's hint can name it "below" and the chain reads down. */}
        <ThrottleSection formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
        <QueueFairnessField formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
        <ScorePrecisionField formData={formData} setFormData={setFormData} validationErrors={validationErrors} />
      </div>
      {/* Why at the tab's foot: it pushes the values the four shared limits hold right now to the
          other kind (tasks), so the button reads as a second way out of the same fields. */}
      <div className="flex justify-end">
        <ApplyLimitsButton
          kinds={['task']}
          label={limits.apply.openButton}
          patch={{
            max_submission_number: formData.max_submission_number,
            max_user_test_number: formData.max_user_test_number,
            min_submission_interval: formData.min_submission_interval,
            min_user_test_interval: formData.min_user_test_interval,
          }}
        />
      </div>
    </div>
  );
}
