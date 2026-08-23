'use client';

import { Modal } from '@/components/core/Modal';
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
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={busy ? 'Deploying Contest...' : 'Confirm Deploy'}
    >
      <div className="space-y-4">
        {(phase === 'idle' || phase === 'already_running') && (
          <>
            <p className="text-neutral-300 text-sm">
              This will mark <strong className="text-white">{targetLabel}</strong> as the active contest,
              update the .env file, and restart the contest stack.{extraNote ? ` ${extraNote}` : ''}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={onConfirm} className="flex items-center gap-2">
                <Rocket className="w-4 h-4" />
                Deploy
              </Button>
            </div>
          </>
        )}
        {busy && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-neutral-300 text-sm">
              {phase === 'deploying' ? 'Starting deploy...' : 'Deploying contest stack...'}
            </p>
          </div>
        )}
        {phase === 'completed' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
            <p className="text-green-300 text-sm font-medium">Contest deployed successfully!</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
