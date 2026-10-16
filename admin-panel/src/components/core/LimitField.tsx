'use client';

import { useId, useRef } from 'react';

import { fieldClasses, LABEL_CLASSES } from '@/components/core/fieldStyles';
import { normalizeLimitValue } from '@/lib/limits';
import { cn } from '@/lib/utils';

export interface LimitFieldProps {
  /** The field's own name, e.g. "Max Submissions". The unit below is appended to it. */
  readonly label: string;
  /** Seconds, minutes, … — read as a suffix: "Max Submissions (sec)". */
  readonly unit?: string;
  /** Muted explanation under the control. */
  readonly hint?: string;
  /** null is "no limit", which is what the empty box shows. */
  readonly value: number | null;
  readonly onChangeValue: (next: number | null) => void;
  /** The field's own validation message, if the last submit refused it. */
  readonly error?: string;
  readonly id?: string;
  /** Accessible name of the infinity toggle, and the empty box's placeholder. */
  readonly unlimitedLabel?: string;
}

/**
 * The one control every nullable limit in the panel is typed in.
 *
 * Why it exists: contest and task modals each hand-rolled the same box-and-toggle, and the two
 * copies drifted — one of them parked the value at 0 when the toggle was pressed, which the
 * contest validator then refused as "must be greater than 0".
 *
 * Why the value is normalised on every keystroke: this control is the only writer of a limit, so
 * routing every commit through normalizeLimitValue is what keeps a typed 0 (or a negative, or a
 * fraction, or a paste) from ever reaching the form as a value the database rejects.
 */
export function LimitField({
  label,
  unit,
  hint,
  value,
  onChangeValue,
  error,
  id,
  unlimitedLabel = 'Unlimited',
}: LimitFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const labelText = unit === undefined ? label : `${label} (${unit})`;
  const isUnlimited = value === null;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [
    hint === undefined ? null : hintId,
    error === undefined ? null : errorId,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    onChangeValue(normalizeLimitValue(event.target.value));
  };

  /**
   * Why pressing the toggle while it is on cannot turn it "off": off would have to be a positive
   * number and there is none to restore, so the press only hands the caret to the box and the
   * operator's first positive number is what ends the unlimited state. Turning it on is
   * unconditional: null clears whatever was there, and never leaves a 0 behind.
   */
  const handleToggle = (): void => {
    if (isUnlimited) {
      inputRef.current?.focus();
      return;
    }
    onChangeValue(null);
  };

  return (
    <div className="space-y-2" data-field={fieldId}>
      <label htmlFor={fieldId} className={LABEL_CLASSES}>
        {labelText}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={fieldId}
          type="number"
          inputMode="numeric"
          step={1}
          value={value ?? ''}
          onChange={handleChange}
          placeholder={unlimitedLabel}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={cn(fieldClasses(error !== undefined), 'min-w-0 flex-1')}
        />
        <button
          type="button"
          onClick={handleToggle}
          aria-pressed={isUnlimited}
          aria-label={unlimitedLabel}
          title={unlimitedLabel}
          className={cn(
            'flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 outline-none transition-colors',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            isUnlimited
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-input bg-muted/30 text-muted-foreground hover:text-foreground'
          )}
        >
          <span aria-hidden className="text-xs font-bold">
            ∞
          </span>
        </button>
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
