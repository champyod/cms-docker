'use client';

import { AlertTriangle, RefreshCw, RotateCcw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { useDictionary } from '@/hooks/useDictionary';
import type { ConfirmationKind } from '@/lib/confirmation-copy';
import type { PendingConfirmation } from '@/lib/confirmation-store';
import { cn } from '@/lib/utils';

interface KindAppearance {
  icon: LucideIcon;
  captionKey: 'destructive' | 'recoverable' | 'operational';
  tone: string;
}

// Captions name the kind so a recoverable edit cannot be mistaken for a permanent deletion.
const KIND_APPEARANCE: Record<ConfirmationKind, KindAppearance> = {
  destructive: { icon: AlertTriangle, captionKey: 'destructive', tone: 'text-destructive' },
  recoverable: { icon: RotateCcw, captionKey: 'recoverable', tone: 'text-muted-foreground' },
  operational: { icon: RefreshCw, captionKey: 'operational', tone: 'text-warning' },
};

interface ConfirmDialogProps {
  confirmation: PendingConfirmation | null;
  onResolve: (confirmed: boolean) => void;
}

export function ConfirmDialog({ confirmation, onResolve }: ConfirmDialogProps): React.JSX.Element | null {
  const confirmations = useDictionary().confirmations;
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
            {confirmations.cancel}
          </Button>
          <Button variant={confirmation.kind === 'destructive' ? 'negative' : 'positive'} onClick={(): void => onResolve(true)}>
            {confirmation.confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', appearance.tone)} aria-hidden />
        <span className={cn('text-xs font-bold tracking-wide uppercase', appearance.tone)}>
          {confirmations.captions[appearance.captionKey]}
        </span>
      </div>
    </Dialog>
  );
}
