'use client';

import type { LucideIcon } from 'lucide-react';

import { Button, type ButtonVariantInput } from '@/components/core/Button';
import { cn } from '@/lib/utils';

export interface ModalFooterProps {
  readonly formId?: string;
  readonly cancelLabel: string;
  /** Omit when the dialog has no confirm action; no confirm button is rendered then. */
  readonly confirmLabel?: string;
  readonly onCancel: () => void;
  /** Only reachable while a confirm label is present. */
  readonly onConfirm?: () => void;
  readonly confirmLoading?: boolean;
  readonly confirmDisabled?: boolean;
  readonly layout?: 'end' | 'split';
  readonly confirmVariant?: ButtonVariantInput;
  readonly cancelVariant?: ButtonVariantInput;
  readonly confirmIcon?: LucideIcon;
  /** Sits before cancel, for a third control that leads the row. */
  readonly leadingAction?: React.ReactNode;
  readonly className?: string;
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
 *
 * Why cancel is invoked unconditionally: pending-cancel is the caller's policy,
 * not the primitive's. A footer whose dialog must refuse cancellation while a
 * save is in flight guards its own `onCancel`, and no prop here may let a
 * pending footer cancel anyway.
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
  confirmVariant = 'positive',
  cancelVariant = 'ghost',
  confirmIcon,
  leadingAction,
  className,
}: ModalFooterProps): React.JSX.Element {
  const submitsOwningForm = formId !== undefined;
  return (
    <div data-footer-layout={layout} className={cn(LAYOUT_CLASSES[layout], className)}>
      {leadingAction}
      <Button type="button" variant={cancelVariant} onClick={onCancel}>
        {cancelLabel}
      </Button>
      {confirmLabel !== undefined && (
        <Button
          type={submitsOwningForm ? 'submit' : 'button'}
          form={formId}
          variant={confirmVariant}
          icon={confirmIcon}
          loading={confirmLoading}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      )}
    </div>
  );
}
