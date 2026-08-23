'use client';

import { useState, useEffect } from 'react';
import { updateContestSettings, removeParticipant, removeTaskFromContest } from '@/app/actions/contests';
import { setTestUser } from '@/app/actions/participations';
import { useDeployContest } from '@/hooks/useDeployContest';

interface ContestLike { id: number; name: string; description: string; timezone: string | null; allow_questions: boolean; allow_user_tests: boolean; submissions_download_allowed: boolean; allow_password_authentication: boolean; allow_registration: boolean; analysis_enabled: boolean; token_mode: string; score_precision: number; start: string | Date | null; stop: string | Date | null; analysis_start: string | Date | null; analysis_stop: string | Date | null; }

export function useContestDetailState(contest: ContestLike) {
  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isParticipationModalOpen, setIsParticipationModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [selectedParticipation, setSelectedParticipation] = useState<{ id: number; username: string } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ info: true, participants: true, tasks: true, services: true });
  const [saving, setSaving] = useState(false);
  const deploy = useDeployContest();
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
  const handleSetActive = () => setShowDeployModal(true);
  const confirmDeploy = () => deploy.deploy(contest.id);

  useEffect(() => {
    const p = deploy.state.phase;
    if (p === 'completed') { setShowDeployModal(false); deploy.reset(); window.location.reload(); }
    else if (p === 'failed' || p === 'timeout') { setShowDeployModal(false); deploy.reset(); alert('Deploy failed: ' + (deploy.state.error || 'Unknown error')); }
    else if (p === 'already_running') { setShowDeployModal(false); deploy.reset(); alert('Another deploy is already in progress.'); }
  }, [deploy.state.phase, deploy.state.error, deploy.reset, deploy.state]);

  const handleOpenParticipationSettings = (participationId: number, username: string) => {
    setSelectedParticipation({ id: participationId, username });
    setIsParticipationModalOpen(true);
  };

  const handleMarkAsTest = async (participationId: number) => {
    if (confirm('Mark this user as a test user? (Hidden + Unrestricted)')) {
      const result = await setTestUser(participationId);
      if (result.success) window.location.reload();
      else alert('Failed: ' + result.error);
    }
  };

  const handleRemoveTask = async (taskId: number) => {
    if (confirm('Remove this task from the contest?')) { await removeTaskFromContest(taskId); window.location.reload(); }
  };

  const handleSave = async () => {
    setSaving(true);
    try { await updateContestSettings(contest.id, formData); window.location.reload(); }
    catch (error) { console.error('Failed to save:', error); }
    finally { setSaving(false); }
  };

  const handleRemoveParticipant = async (participationId: number) => {
    if (confirm('Remove this participant from the contest?')) { await removeParticipant(participationId); window.location.reload(); }
  };

  return {
    isParticipantModalOpen, setIsParticipantModalOpen,
    isTaskModalOpen, setIsTaskModalOpen,
    isParticipationModalOpen, setIsParticipationModalOpen,
    isTeamModalOpen, setIsTeamModalOpen,
    selectedParticipation, setSelectedParticipation,
    expandedSections, toggleSection, saving,
    deployState: deploy.state, confirmDeploy, resetDeployState: deploy.reset, showDeployModal, setShowDeployModal, handleSetActive,
    formData, setFormData, handleSave,
    handleOpenParticipationSettings, handleMarkAsTest, handleRemoveTask, handleRemoveParticipant,
  };
}
