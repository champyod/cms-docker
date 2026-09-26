'use client';

import {
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
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

// Why: deploying always replaces the active contest, so the consequence is the modal's default note —
// callers may override it but can never forget it.
const DEFAULT_EXTRA_NOTE = 'The previous active contest will be deactivated.';

/** Phase-aware deploy dialog shared by ContestList and the Contest record header. Close is locked while a deploy runs. */
export function DeployConfirmModal({ isOpen, phase, targetLabel, extraNote = DEFAULT_EXTRA_NOTE, onClose, onConfirm }: DeployConfirmModalProps) {
  const busy = BUSY_PHASES.includes(phase);

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{busy ? 'Deploying Contest...' : 'Confirm Deploy'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {(phase === 'idle' || phase === 'already_running') && (
            <>
              <p className="text-sm text-muted-foreground">
                This will mark <strong className="text-foreground">{targetLabel}</strong> as the active contest,
                set CONTEST_ID in config.toml [contest], and restart the contest stack. {extraNote}
              </p>
              <ModalFooter
                cancelLabel="Cancel"
                confirmLabel="Deploy"
                onCancel={onClose}
                onConfirm={onConfirm}
                confirmIcon={Rocket}
              />
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
    </DialogRoot>
  );
}
