'use client';

import { Info } from 'lucide-react';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { LimitField } from '@/components/core/LimitField';
import { Input } from '@/components/core/Input';
import { Select, type SelectOption } from '@/components/core/Select';
import { LABEL_CLASSES } from '@/components/core/fieldStyles';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { normalizeNonNegativeInt, type LimitFieldName } from '@/lib/limits';
import { cn } from '@/lib/utils';
import type { TaskData } from '@/app/actions/tasks';

const FIELD_LABEL = cn('mb-2 block', LABEL_CLASSES);

const SCORE_MODES: readonly SelectOption[] = [
  { value: 'max', label: 'Max' },
  { value: 'max_subtask', label: 'Max Subtask' },
  { value: 'max_tokened_last', label: 'Max Tokened Last' },
];

const FEEDBACK_LEVELS: readonly SelectOption[] = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'oi_restricted', label: 'OI Restricted' },
  { value: 'full', label: 'Full' },
];

export function InfoButton({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="group relative inline-block ml-1.5 align-middle">
      <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary cursor-help transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-lg text-xs font-medium text-muted-foreground w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-popover" />
      </div>
    </div>
  );
}

interface TabProps {
  formData: TaskData;
  onChange: (data: TaskData) => void;
}

/** The limit family the task modal shares with the contest modal, by its own names. */
type TaskLimitField = Extract<keyof TaskData, LimitFieldName>;

interface LimitRow {
  readonly name: TaskLimitField;
  readonly unit?: string;
}

/** The limits this tab owns, in reading order: the token caps belong to the tokens tab. */
const LIMIT_ROWS: readonly LimitRow[] = [
  { name: 'max_submission_number' },
  { name: 'max_user_test_number' },
  { name: 'min_submission_interval', unit: 'sec' },
  { name: 'min_user_test_interval', unit: 'sec' },
];

/**
 * Why the patch is typed out: a computed key over a union of field names would widen the object and
 * the strict task type would refuse it, while this partial is exactly the write it performs.
 */
function writeLimit(
  name: TaskLimitField,
  next: number | null,
  formData: TaskData,
  onChange: (data: TaskData) => void
): void {
  const patch: Partial<Record<TaskLimitField, number | null>> = { [name]: next };
  onChange({ ...formData, ...patch });
}

export function GeneralTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="task-name" className={FIELD_LABEL}>
          Task Name (Short ID)
          <InfoButton text="Unique identifier (e.g., 'aplusb'). Only letters, numbers, underscores and dashes allowed." />
        </label>
        <Input
          id="task-name"
          type="text"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
          placeholder="e.g., aplusb"
          required
        />
      </div>
      <div>
        <label htmlFor="task-title" className={FIELD_LABEL}>Title</label>
        <Input
          id="task-title"
          type="text"
          value={formData.title}
          onChange={(e) => onChange({ ...formData, title: e.target.value })}
          placeholder="e.g., A Plus B Problem"
          required
        />
      </div>
    </div>
  );
}

export function GradingTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="task-score-mode" className={FIELD_LABEL}>
            Score Mode
            <InfoButton text="Defines how the final score is calculated from multiple datasets/submissions." />
          </label>
          <Select
            id="task-score-mode"
            value={formData.score_mode}
            onChange={(e) => onChange({ ...formData, score_mode: e.target.value })}
            options={SCORE_MODES}
          />
        </div>
        <div>
          <label htmlFor="task-feedback-level" className={FIELD_LABEL}>
            Feedback Level
            <InfoButton text="Determines how much information is shown to the participant after a submission." />
          </label>
          <Select
            id="task-feedback-level"
            value={formData.feedback_level}
            onChange={(e) => onChange({ ...formData, feedback_level: e.target.value })}
            options={FEEDBACK_LEVELS}
          />
        </div>
      </div>
      <div>
        <label htmlFor="task-score-precision" className={FIELD_LABEL}>Score Precision</label>
        <Input
          id="task-score-precision"
          type="number"
          value={formData.score_precision ?? ''}
          onChange={(e) => onChange({ ...formData, score_precision: e.target.value ? parseInt(e.target.value, 10) : null })}
          placeholder="0"
        />
        <p className="text-xs text-muted-foreground mt-1">Number of decimal places for score.</p>
      </div>
    </div>
  );
}

/**
 * The task's half of the throttle family: a tri-state override of the contest's delay.
 *
 * Why a box whose blank is a state: blank writes NULL — "inherit the contest's delay" — 0 writes a
 * real 0, "no delay for this task", and N writes N seconds for this task only. The line under it
 * names which of the three the current value is, so the operator can tell an inherit from a 0.
 */
function ThrottleOverrideField({ formData, onChange }: TabProps): React.JSX.Element {
  const throttle = useDictionary().limits.throttle;
  const value = formData.evaluation_throttle_delay_s ?? null;
  const stateHint = value === null
    ? throttle.overrideInherit
    : value === 0
      ? throttle.overrideNone
      : interpolate(throttle.overrideSeconds, { seconds: value });
  return (
    <div className="space-y-1 md:col-span-2" data-field="evaluation_throttle_delay_s">
      <label htmlFor="evaluation_throttle_delay_s" className={FIELD_LABEL}>{throttle.overrideLabel} (sec)</label>
      <Input
        id="evaluation_throttle_delay_s"
        type="number"
        min={0}
        step={1}
        placeholder={throttle.overridePlaceholder}
        value={value ?? ''}
        onChange={(e) => onChange({ ...formData, evaluation_throttle_delay_s: normalizeNonNegativeInt(e.target.value) })}
      />
      <p className="text-xs text-muted-foreground">{throttle.overrideHint}</p>
      <p className="text-xs font-medium text-primary">{stateHint}</p>
    </div>
  );
}

export function LimitsTab({ formData, onChange }: TabProps): React.JSX.Element {
  const limits = useDictionary().limits;
  // Why a partial: the label map covers the whole family, the hint map only fields that need explaining.
  const hints: Partial<Record<TaskLimitField, string>> = limits.hints;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {LIMIT_ROWS.map((row) => (
          <LimitField
            key={row.name}
            id={row.name}
            label={limits.fields[row.name]}
            unit={row.unit}
            hint={hints[row.name]}
            value={formData[row.name] ?? null}
            onChangeValue={(next) => writeLimit(row.name, next, formData, onChange)}
            unlimitedLabel={limits.unlimited}
          />
        ))}
        <ThrottleOverrideField formData={formData} onChange={onChange} />
      </div>
      {/* Why here: it pushes the four shared limits to the contest kind, a second way out of the same fields. */}
      <div className="flex justify-end">
        <ApplyLimitsButton
          kinds={['contest']}
          label={limits.apply.openButton}
          patch={{
            max_submission_number: formData.max_submission_number ?? null,
            max_user_test_number: formData.max_user_test_number ?? null,
            min_submission_interval: formData.min_submission_interval ?? null,
            min_user_test_interval: formData.min_user_test_interval ?? null,
          }}
        />
      </div>
    </div>
  );
}

export { TokensTab, LanguagesTab } from './task-modal-extra';
