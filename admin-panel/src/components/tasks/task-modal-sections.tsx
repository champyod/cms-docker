'use client';

import { Info } from 'lucide-react';

import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { LimitField } from '@/components/core/LimitField';
import { useDictionary } from '@/hooks/useDictionary';
import type { LimitFieldName } from '@/lib/limits';
import type { TaskData } from '@/app/actions/tasks';

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
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">
          Task Name (Short ID)
          <InfoButton text="Unique identifier (e.g., 'aplusb'). Only letters, numbers, underscores and dashes allowed." />
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
          placeholder="e.g., aplusb"
          required
          className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Title</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => onChange({ ...formData, title: e.target.value })}
          placeholder="e.g., A Plus B Problem"
          required
          className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors"
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
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">
            Score Mode
            <InfoButton text="Defines how the final score is calculated from multiple datasets/submissions." />
          </label>
          <select
            value={formData.score_mode}
            onChange={(e) => onChange({ ...formData, score_mode: e.target.value })}
            className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="max">Max</option>
            <option value="max_subtask">Max Subtask</option>
            <option value="max_tokened_last">Max Tokened Last</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">
            Feedback Level
            <InfoButton text="Determines how much information is shown to the participant after a submission." />
          </label>
          <select
            value={formData.feedback_level}
            onChange={(e) => onChange({ ...formData, feedback_level: e.target.value })}
            className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="restricted">Restricted</option>
            <option value="oi_restricted">OI Restricted</option>
            <option value="full">Full</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Score Precision</label>
        <input
          type="number"
          value={formData.score_precision ?? ''}
          onChange={(e) => onChange({ ...formData, score_precision: e.target.value ? parseInt(e.target.value, 10) : null })}
          placeholder="0"
          className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground mt-1">Number of decimal places for score.</p>
      </div>
    </div>
  );
}

export function LimitsTab({ formData, onChange }: TabProps): React.JSX.Element {
  const limits = useDictionary().limits;
  // Why the cast to a partial: the label map covers the whole family, the hint map only the
  // fields that need explaining.
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
      </div>
      {/* Why at the tab's foot: it pushes the values the four shared limits hold right now to the
          other kind (contests), so the button reads as a second way out of the same fields. */}
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
