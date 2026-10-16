'use client';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { LimitField } from '@/components/core/LimitField';
import { useDictionary } from '@/hooks/useDictionary';
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
