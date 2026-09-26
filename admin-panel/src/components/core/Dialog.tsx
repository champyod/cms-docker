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

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: DialogProps) {
  const invokeRef = useRef<HTMLElement | null>(null);
  const isContentEmpty = children === null || children === undefined;

  // Why this capture: every dialog in the panel is opened from a controlled
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

  return (
    <UIDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className} onOpenAutoFocus={rememberInvoker} onCloseAutoFocus={restoreInvoker}>
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
