'use client';

import { useCallback, useState } from 'react';

import { ApplyToTargetsDialog, type TargetKind } from '@/components/core/ApplyToTargetsDialog';
import { Button } from '@/components/core/Button';
import type { TargetOption } from '@/components/core/TargetMultiSelect';
import { listLimitTargets } from '@/app/actions/limitTargets';
import type { LimitFieldName } from '@/lib/limits';

export interface ApplyLimitsButtonProps {
  /** The kinds this button's dialog may target. */
  readonly kinds: readonly TargetKind[];
  /** The limit fields to edit and their seed values. */
  readonly patch: Partial<Record<LimitFieldName, number | null>>;
  /** The ids the entry point already picked. */
  readonly preselected?: Partial<Record<TargetKind, readonly number[]>>;
  /** See ApplyToTargetsDialog: true for a modal entry, false for the list bulk bars. */
  readonly initiallyTouched?: boolean;
  /** The button's own label, from the dictionary. */
  readonly label: string;
  readonly onSuccess?: () => void;
  readonly className?: string;
}

/**
 * The one "Apply to…" control every entry point renders.
 *
 * Why one component: the same dialog, the same target loader and the same open/close state serve
 * the contest modal, the task modal and both list bulk bars, so each surface adds a call site, not
 * another copy. It owns the loader wiring so core stays feature-free and no tab repeats the action
 * import.
 */
export function ApplyLimitsButton({
  kinds,
  patch,
  preselected,
  initiallyTouched,
  label,
  onSuccess,
  className,
}: ApplyLimitsButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Why memoised: the dialog fetches its target lists in an effect keyed on this loader, so a fresh
  // identity on every render of this button would re-fetch them mid-edit.
  const loadTargets = useCallback((kind: TargetKind): Promise<TargetOption[]> => listLimitTargets(kind), []);
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ApplyToTargetsDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        kinds={kinds}
        patch={patch}
        preselected={preselected}
        initiallyTouched={initiallyTouched}
        loadTargets={loadTargets}
        onSuccess={onSuccess}
      />
    </>
  );
}
