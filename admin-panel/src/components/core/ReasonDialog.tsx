'use client';

import { NameDialog } from '@/components/core/NameDialog';
import type { ReasonAction, ReasonActionResult } from '@/hooks/useReasonPrompt';

interface ReasonDialogProps {
  readonly request: ReasonAction | null;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => Promise<ReasonActionResult>;
}

const MISSING_REASON = 'A reason is required';

/**
 * Asks for the reason behind an audited action, in the dialog that runs it.
 * Delegates to NameDialog: a reason is one required string, exactly its shape.
 */
export function ReasonDialog({ request, onClose, onSubmit }: ReasonDialogProps): React.JSX.Element {
  return (
    <NameDialog
      open={request !== null}
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={request?.title ?? ''}
      description={request?.description}
      initialValue=""
      submitLabel={request?.submitLabel ?? 'Confirm'}
      cancelLabel="Cancel"
      validate={(value): string | undefined => (value.trim().length === 0 ? MISSING_REASON : undefined)}
      onSubmit={onSubmit}
    />
  );
}
