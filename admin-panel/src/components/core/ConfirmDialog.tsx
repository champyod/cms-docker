'use client';

import { AlertTriangle, RefreshCw, RotateCcw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import type { ConfirmationKind } from '@/lib/confirmation-copy';
import type { PendingConfirmation } from '@/lib/confirmation-store';
import { cn } from '@/lib/utils';

interface KindAppearance {
  icon: LucideIcon;
  caption: string;
  tone: string;
}

// Captions name the kind so a recoverable edit cannot be mistaken for a permanent deletion.
const KIND_APPEARANCE: Record<ConfirmationKind, KindAppearance> = {
  destructive: { icon: AlertTriangle, caption: 'Irreversible', tone: 'text-destructive' },
  recoverable: { icon: RotateCcw, caption: 'Reversible', tone: 'text-muted-foreground' },
  operational: { icon: RefreshCw, caption: 'Service impact', tone: 'text-warning' },
};

interface ConfirmDialogProps {
  confirmation: PendingConfirmation | null;
  onResolve: (confirmed: boolean) => void;
}

export function ConfirmDialog({ confirmation, onResolve }: ConfirmDialogProps): React.JSX.Element | null {
  if (!confirmation) return null;
  const appearance = KIND_APPEARANCE[confirmation.kind];
  const Icon = appearance.icon;
  // Escape, the overlay and the close button all dismiss as "not confirmed" via Dialog's onOpenChange.
  return (
    <Dialog
      open
      onOpenChange={(open): void => {
        if (!open) onResolve(false);
      }}
      title={confirmation.title}
      description={confirmation.description}
      footer={
        <div className="flex w-full justify-end gap-3">
          <Button variant="ghost" onClick={(): void => onResolve(false)}>
            Cancel
          </Button>
          <Button variant={confirmation.kind === 'destructive' ? 'negative' : 'positive'} onClick={(): void => onResolve(true)}>
            {confirmation.confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', appearance.tone)} aria-hidden />
        <span className={cn('text-xs font-bold tracking-wide uppercase', appearance.tone)}>{appearance.caption}</span>
      </div>
    </Dialog>
  );
}
