'use client';

import { useCallback, useState } from 'react';

import { Dialog } from '@/components/core/Dialog';
import { FormField } from '@/components/core/FormField';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Input } from '@/components/core/Input';
import { ModalFooter } from '@/components/core/ModalFooter';

export interface NameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly initialValue: string;
  readonly submitLabel: string;
  readonly cancelLabel: string;
  readonly validate?: (value: string) => string | undefined;
  readonly onSubmit: (value: string) => Promise<{ readonly success: boolean; readonly error?: string }>;
}

const FIELD_ID = 'name-dialog-value';

/**
 * Rename/clone dialog for a single string value.
 *
 * Why the value is trimmed once and validated once before submit: a name that
 * differs only by surrounding whitespace is the same name to the server, so
 * comparing the trimmed form is what keeps "  copy" from failing a uniqueness
 * check that "copy" would have passed.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  submitLabel,
  cancelLabel,
  validate,
  onSubmit,
}: NameDialogProps): React.JSX.Element | null {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Why state is adjusted during render rather than in an effect: seeding on
  // the closed-to-open edge must land before the input paints, and an effect
  // would show one frame of the previous value first.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(initialValue);
      setError(undefined);
      setPending(false);
    }
  }

  // Why a pending submit blocks dismissal: the action already left the browser,
  // and closing here would hide its result and leave a half-named record.
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (pending) return;
      onOpenChange(next);
    },
    [pending, onOpenChange],
  );

  const handleSubmit = useCallback((): void => {
    if (pending) return;
    const trimmed = value.trim();
    const validationMessage = validate?.(trimmed);
    if (validationMessage !== undefined) {
      setError(validationMessage);
      return;
    }
    setError(undefined);
    setPending(true);
    void onSubmit(trimmed).then((result) => {
      if (result.success) {
        onOpenChange(false);
        return;
      }
      setPending(false);
      setError(result.error);
    });
  }, [onSubmit, onOpenChange, pending, validate, value]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      footer={
        <ModalFooter
          cancelLabel={cancelLabel}
          confirmLabel={submitLabel}
          onCancel={(): void => handleOpenChange(false)}
          onConfirm={handleSubmit}
          confirmLoading={pending}
        />
      }
    >
      <div className="space-y-4">
        {error !== undefined && (
          <InlineAlert tone="destructive" title={error}>
            {description}
          </InlineAlert>
        )}
        <FormField id={FIELD_ID} label={title} error={undefined}>
          {(props) => (
            <Input
              {...props}
              value={value}
              disabled={pending}
              onChange={(event): void => setValue(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
