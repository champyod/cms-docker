'use client';

import { useState } from 'react';
import { useConfirm } from '@/hooks/useConfirm';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { removeParticipant } from '@/app/actions/contests';
import { setTestUser } from '@/app/actions/participations';
import { useTabConfirmationCopy, useTabRefresh } from './useContestSettingsState';

export interface SelectedParticipation {
  id: number;
  username: string;
}

function useParticipantDialogState(): {
  isParticipantModalOpen: boolean;
  setIsParticipantModalOpen: (open: boolean) => void;
  isTeamModalOpen: boolean;
  setIsTeamModalOpen: (open: boolean) => void;
  isParticipationModalOpen: boolean;
  selectedParticipation: SelectedParticipation | null;
  handleOpenParticipationSettings: (participationId: number, username: string) => void;
  closeParticipationModal: () => void;
} {
  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isParticipationModalOpen, setIsParticipationModalOpen] = useState(false);
  const [selectedParticipation, setSelectedParticipation] = useState<SelectedParticipation | null>(null);

  const handleOpenParticipationSettings = (participationId: number, username: string): void => {
    setSelectedParticipation({ id: participationId, username });
    setIsParticipationModalOpen(true);
  };

  const closeParticipationModal = (): void => {
    setIsParticipationModalOpen(false);
    setSelectedParticipation(null);
  };

  return {
    isParticipantModalOpen, setIsParticipantModalOpen,
    isTeamModalOpen, setIsTeamModalOpen,
    isParticipationModalOpen, selectedParticipation,
    handleOpenParticipationSettings, closeParticipationModal,
  };
}

export function useContestParticipantActions(): {
  isParticipantModalOpen: boolean;
  setIsParticipantModalOpen: (open: boolean) => void;
  isTeamModalOpen: boolean;
  setIsTeamModalOpen: (open: boolean) => void;
  isParticipationModalOpen: boolean;
  selectedParticipation: SelectedParticipation | null;
  handleOpenParticipationSettings: (participationId: number, username: string) => void;
  closeParticipationModal: () => void;
  handleMarkAsTest: (participationId: number) => Promise<void>;
  handleRemoveParticipant: (participationId: number) => Promise<void>;
} {
  const dialogs = useParticipantDialogState();
  const confirm = useConfirm();
  const copy = useTabConfirmationCopy();
  const runAction = useActionFeedback();
  const refresh = useTabRefresh();

  const handleMarkAsTest = async (participationId: number): Promise<void> => {
    if (!(await confirm(copy.markTestUserConfirm()))) return;
    const result = await runAction(
      { pending: 'Marking test user...', success: 'Marked as test user', failure: 'Mark failed' },
      () => setTestUser(participationId),
    );
    if (result?.success) refresh();
  };

  const handleRemoveParticipant = async (participationId: number): Promise<void> => {
    if (!(await confirm(copy.removeParticipantConfirm()))) return;
    const result = await runAction(
      { pending: 'Removing participant...', success: 'Participant removed', failure: 'Remove failed' },
      () => removeParticipant(participationId),
    );
    if (result?.success) refresh();
  };

  return {
    ...dialogs,
    handleMarkAsTest, handleRemoveParticipant,
  };
}
