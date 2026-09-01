'use client';

import * as React from 'react';

import {
  Dialog as UIDialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/core/EmptyState';
import { cn } from '@/lib/utils';

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
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </UIDialog>
  );
}

// Footer convention: cancel/negative buttons LEFT, primary action RIGHT-most.
export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      {children}
    </div>
  );
}
