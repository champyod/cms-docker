'use client';

import { useState, useEffect } from 'react';
import { useJustSavedFlag } from '@/hooks/useJustSavedFlag';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useRouter } from 'next/navigation';
import { updateContestSettings, removeParticipant, removeTaskFromContest } from '@/app/actions/contests';
import { setTestUser } from '@/app/actions/participations';
import { useDeployContest } from '@/hooks/useDeployContest';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';

interface ContestLike { id: number; name: string; description: string; timezone: string | null; allow_questions: boolean; allow_user_tests: boolean; submissions_download_allowed: boolean; allow_password_authentication: boolean; allow_registration: boolean; analysis_enabled: boolean; token_mode: string; score_precision: number; start: string | Date | null; stop: string | Date | null; analysis_start: string | Date | null; analysis_stop: string | Date | null; }

export function useContestDetailState(contest: ContestLike) {
  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isParticipationModalOpen, setIsParticipationModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [selectedParticipation, setSelectedParticipation] = useState<{ id: number; username: string } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ info: true, participants: true, tasks: true, services: true });
  const [saving, setSaving] = useState(false);
  const { justSaved, flashSaved } = useJustSavedFlag();
  const router = useRouter();
  const deploy = useDeployContest();
  const confirm = useConfirm();
  const { markTestUserConfirm, removeParticipantConfirm, removeTaskFromContestConfirm } = useConfirmationCopy();
  const { state: deployState, deploy: launchDeploy, reset: resetDeploy } = deploy;
  const [showDeployModal, setShowDeployModal] = useState(false);

  const [formData, setFormData] = useState({
    name: contest.name, description: contest.description, timezone: contest.timezone || '',
    allow_questions: contest.allow_questions, allow_user_tests: contest.allow_user_tests,
    submissions_download_allowed: contest.submissions_download_allowed, allow_password_authentication: contest.allow_password_authentication,
    allow_registration: contest.allow_registration, analysis_enabled: contest.analysis_enabled,
    token_mode: contest.token_mode, score_precision: contest.score_precision,
    start: contest.start ? new Date(contest.start).toISOString().slice(0, 16) : '',
    stop: contest.stop ? new Date(contest.stop).toISOString().slice(0, 16) : '',
    analysis_start: contest.analysis_start ? new Date(contest.analysis_start).toISOString().slice(0, 16) : '',
    analysis_stop: contest.analysis_stop ? new Date(contest.analysis_stop).toISOString().slice(0, 16) : '',
  });

  const toggleSection = (section: string) => setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  const handleSetActive = (): void => {
    if (deployState.phase !== 'deploying' && deployState.phase !== 'polling') resetDeploy();
    setShowDeployModal(true);
  };
  const confirmDeploy = () => launchDeploy(contest.id);

  useEffect(() => {
    // Refresh contest data without destroying the shared owner or consuming its result.
    if (deployState.phase === 'completed') router.refresh();
    if (['completed', 'failed', 'timeout', 'already_running'].includes(deployState.phase)) {
      queueMicrotask((): void => setShowDeployModal(false));
    }
  }, [deployState.phase, router]);

  const handleOpenParticipationSettings = (participationId: number, username: string) => {
    setSelectedParticipation({ id: participationId, username });
    setIsParticipationModalOpen(true);
  };

  const runAction = useActionFeedback();

  const handleMarkAsTest = async (participationId: number) => {
    if (!(await confirm(markTestUserConfirm()))) return;
    const result = await runAction(
      { pending: 'Marking test user...', success: 'Marked as test user', failure: 'Mark failed' },
      () => setTestUser(participationId)
    );
    if (result?.success) router.refresh();
  };

  const handleRemoveTask = async (taskId: number) => {
    if (!(await confirm(removeTaskFromContestConfirm()))) return;
    const result = await runAction(
      { pending: 'Removing task...', success: 'Task removed', failure: 'Remove failed' },
      () => removeTaskFromContest(taskId)
    );
    if (result?.success) router.refresh();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await runAction(
        {
          pending: 'Saving contest...',
          success: 'Contest saved',
          failure: 'Save failed',
          description: 'Settings updated successfully.',
        },
        () => updateContestSettings(contest.id, formData)
      );
      if (!result) return;
      if (result.success) {
        flashSaved();
        router.refresh();
      }
    }
    finally { setSaving(false); }
  };

  const handleRemoveParticipant = async (participationId: number) => {
    if (!(await confirm(removeParticipantConfirm()))) return;
    const result = await runAction(
      { pending: 'Removing participant...', success: 'Participant removed', failure: 'Remove failed' },
      () => removeParticipant(participationId)
    );
    if (result?.success) router.refresh();
  };

  return {
    isParticipantModalOpen, setIsParticipantModalOpen,
    isTaskModalOpen, setIsTaskModalOpen,
    isParticipationModalOpen, setIsParticipationModalOpen,
    isTeamModalOpen, setIsTeamModalOpen,
    selectedParticipation, setSelectedParticipation,
    expandedSections, toggleSection, saving, justSaved,
    deployState, confirmDeploy, resetDeployState: resetDeploy, showDeployModal, setShowDeployModal, handleSetActive,
    formData, setFormData, handleSave,
    handleOpenParticipationSettings, handleMarkAsTest, handleRemoveTask, handleRemoveParticipant,
  };
}
