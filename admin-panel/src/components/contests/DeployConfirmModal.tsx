'use client';

import { Dialog as UIDialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DialogFooter } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { CheckCircle2, Loader2, Rocket } from 'lucide-react';
import type { DeployPhase } from '@/hooks/useDeployContest';

const BUSY_PHASES: DeployPhase[] = ['deploying', 'polling'];

interface DeployConfirmModalProps {
  isOpen: boolean;
  phase: DeployPhase;
  targetLabel: string;
  extraNote?: string;
  onClose: () => void;
  onConfirm: () => void;
}

/** Phase-aware deploy dialog shared by ContestList and ContestDetailView. Close is locked while a deploy runs. */
export function DeployConfirmModal({ isOpen, phase, targetLabel, extraNote, onClose, onConfirm }: DeployConfirmModalProps) {
  const busy = BUSY_PHASES.includes(phase);

  return (
    <UIDialog open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{busy ? 'Deploying Contest...' : 'Confirm Deploy'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {(phase === 'idle' || phase === 'already_running') && (
            <>
              <p className="text-sm text-muted-foreground">
                This will mark <strong className="text-foreground">{targetLabel}</strong> as the active contest,
                update the .env file, and restart the contest stack.{extraNote ? ` ${extraNote}` : ''}
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="positive" icon={Rocket} onClick={onConfirm}>Deploy</Button>
              </DialogFooter>
            </>
          )}
          {busy && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {phase === 'deploying' ? 'Starting deploy...' : 'Deploying contest stack...'}
              </p>
            </div>
          )}
          {phase === 'completed' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium text-success">Contest deployed successfully!</p>
            </div>
          )}
        </div>
      </DialogContent>
    </UIDialog>
  );
}
