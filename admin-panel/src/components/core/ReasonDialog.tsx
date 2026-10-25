'use client';

import { NameDialog } from '@/components/core/NameDialog';
import { useDictionary } from '@/hooks/useDictionary';
import type { ReasonAction, ReasonActionResult } from '@/hooks/useReasonPrompt';

interface ReasonDialogProps {
  readonly request: ReasonAction | null;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => Promise<ReasonActionResult>;
}

/** Asks for the reason behind an audited action, in the dialog that runs it; labels come from the dictionary. */
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
