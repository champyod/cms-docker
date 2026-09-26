'use client';

import { Button } from '@/components/core/Button';

export interface ModalFooterProps {
  readonly formId?: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly confirmLoading?: boolean;
  readonly confirmDisabled?: boolean;
  readonly layout?: 'end' | 'split';
}

const LAYOUT_CLASSES = {
  end: 'flex w-full justify-end gap-3',
  split: 'flex w-full items-center justify-between gap-3',
} as const;

/**
 * Confirm/cancel pair shared by every dialog in the panel.
 *
 * Why a form id instead of an always-onClick confirm: a dialog that owns a
 * `<form>` must submit through it so the browser runs native validation and the
 * consumer keeps one submit handler instead of two.
 */
export function ModalFooter({
  formId,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmLoading,
  confirmDisabled,
  layout = 'end',
}: ModalFooterProps): React.JSX.Element {
  const submitsOwningForm = formId !== undefined;
  return (
    <div data-footer-layout={layout} className={LAYOUT_CLASSES[layout]}>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        type={submitsOwningForm ? 'submit' : 'button'}
        form={formId}
        variant="positive"
        loading={confirmLoading}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
