'use client';

import { NameDialog } from '@/components/core/NameDialog';
import { useDictionary } from '@/hooks/useDictionary';
import type { ReasonAction, ReasonActionResult } from '@/hooks/useReasonPrompt';

interface ReasonDialogProps {
  readonly request: ReasonAction | null;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => Promise<ReasonActionResult>;
}

/**
 * Asks for the reason behind an audited action, in the dialog that runs it.
 * Delegates to NameDialog: a reason is one required string, exactly its shape.
 *
 * Why the two fixed strings come from the dictionary: this dialog sits in front of a Thai operator on
 * every audited action in the panel, and "Cancel" beside Thai body copy is the same defect as an
 * alert composed in English — the reader is asked to justify an action in a language they may not read.
 */
export function ReasonDialog({ request, onClose, onSubmit }: ReasonDialogProps): React.JSX.Element {
  const copy = useDictionary().reasonDialog;
  return (
    <NameDialog
      open={request !== null}
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={request?.title ?? ''}
      description={request?.description}
      initialValue=""
      submitLabel={request?.submitLabel ?? copy.confirm}
      cancelLabel={copy.cancel}
      validate={(value): string | undefined => (value.trim().length === 0 ? copy.required : undefined)}
      onSubmit={onSubmit}
    />
  );
}
