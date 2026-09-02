'use client';

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
  const isContentEmpty = children === null || children === undefined;
  return (
    <UIDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
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
