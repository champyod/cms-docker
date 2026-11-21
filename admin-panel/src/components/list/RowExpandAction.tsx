'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';

import { ROW_ACTION_CLASSES } from '@/components/list/RowActionLink';
import { cn } from '@/lib/utils';

export interface RowExpandActionProps {
  /** Whether the row's detail is currently open. */
  readonly expanded: boolean;
  /** Names the row for a reader who cannot see which chevron belongs to which record. */
  readonly ariaLabel: string;
  readonly onToggle: () => void;
  readonly className?: string;
}

/**
 * The chevron that opens a record's detail from its row.
 *
 * Why shared: the audit log and the submission testcase table render the same
 * control in a right-aligned detail column, so both lists own their expansion this
 * way instead of hand-rolling the button twice.
 */
export function RowExpandAction({ expanded, ariaLabel, onToggle, className }: RowExpandActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(ROW_ACTION_CLASSES, className)}
    >
      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </button>
  );
}
