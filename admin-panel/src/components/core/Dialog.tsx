'use client';

import { useCallback, useRef } from 'react';
import {
  Dialog as UIDialog,
  DialogContent,
  DialogDescription,
  DialogFooter as UIDialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/core/EmptyState';
import type { DismissReason } from '@/hooks/useUnsavedChangesGuard';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean, reason: DismissReason) => void;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Refuses every dismissal while a submit is in flight. The dialog is controlled,
   * so ignoring the close request is what keeps the action's result on screen.
   */
  pending?: boolean;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
  pending = false,
}: DialogProps) {
  const invokeRef = useRef<HTMLElement | null>(null);
  const reasonRef = useRef<DismissReason>('close');
  const isContentEmpty = children === null || children === undefined;

  // Why the capture: every dialog in the panel is opened from a controlled
  // `open` flag, so Radix has no trigger to return focus to and a close would
  // otherwise drop focus on the document body mid-record.
  const rememberInvoker = useCallback((): void => {
    if (invokeRef.current === null && document.activeElement instanceof HTMLElement) {
      invokeRef.current = document.activeElement;
    }
  }, []);

  const restoreInvoker = useCallback((event: Event): void => {
    event.preventDefault();
    const invoker = invokeRef.current;
    invokeRef.current = null;
    // Why this guard: a row action that opened the dialog can unmount while it is
    // open — a delete that removes the row, a filter that drops it — and focusing a
    // detached node is a silent no-op that would strand focus on the document body.
    if (invoker?.isConnected === true) invoker.focus();
  }, []);

  // Why the reason: Radix reports a dismissal as a bare `false`, so a form that
  // has to ask before losing its edits cannot tell Escape from the overlay, and
  // a caller that forwards the reason needs one value per dismissal path.
  const handleOpenChange = useCallback((next: boolean): void => {
    if (next) {
      reasonRef.current = 'close';
      onOpenChange(true, 'close');
      return;
    }
    if (pending) return;
    onOpenChange(false, reasonRef.current);
  }, [onOpenChange, pending]);

  return (
    <UIDialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={className}
        onOpenAutoFocus={rememberInvoker}
        onCloseAutoFocus={restoreInvoker}
        onEscapeKeyDown={(): void => { reasonRef.current = 'escape'; }}
        onInteractOutside={(): void => { reasonRef.current = 'backdrop'; }}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        {isContentEmpty ? <EmptyState title="No content available" description="Dialog content is empty" /> : children}
        {footer && <UIDialogFooter>{footer}</UIDialogFooter>}
      </DialogContent>
    </UIDialog>
  );
}

export { UIDialogFooter as DialogFooter };

// Why the raw parts are re-exported here: a consumer that assembles its own
// dialog body (a command palette, a confirm modal) still has to reach the
// adapter through core rather than importing the adapter itself.
export {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
};
