'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { ContestModal } from './ContestModal';
import type { ExistingContest } from './contest-modal/types';
import { ParticipantModal } from './ParticipantModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { TaskSelectionModal } from './TaskSelectionModal';
import { ContestCommunications } from './ContestCommunications';
import { ParticipationModal } from './ParticipationModal';
import { TeamBulkAddModal } from './TeamBulkAddModal';
import { useContestDetailState } from './contest-detail/useContestDetailState';
import { ContestDetailHeader } from './contest-detail/ContestDetailHeader';
import { ContestStatusCard } from './contest-detail/ContestStatusCard';
import { ContestParticipantsSection } from './contest-detail/ContestParticipantsSection';
import { ContestTasksSection } from './contest-detail/ContestTasksSection';
import { ContestSettingsSection } from './contest-detail/ContestSettingsSection';
import type { Prisma } from '@prisma/client';
import type { ContestDetailRow, SafeAdmin } from '@/lib/prisma-selects';

type AvailableUserRow = Prisma.usersGetPayload<Record<string, never>>;
type AvailableTaskRow = Prisma.tasksGetPayload<Record<string, never>>;
type TeamRow = Prisma.teamsGetPayload<Record<string, never>>;

interface ContestDetailViewProps {
  contest: ContestDetailRow;
  availableUsers: AvailableUserRow[];
  availableTasks: AvailableTaskRow[];
  teams: TeamRow[];
  user: SafeAdmin;
  permissionKeys?: readonly string[];
}

export function ContestDetailView({ contest, availableUsers, availableTasks, teams, user, permissionKeys }: ContestDetailViewProps) {
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname.split('/')[1] || 'en';
  const s = useContestDetailState(contest);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const effective = useMemo(() => new Set(permissionKeys ?? []), [permissionKeys]);
  const canUpdate = hasEffectivePermission(effective, 'contest:update');
  const participantUserIds = new Set(contest.participations.map((p: ContestDetailRow['participations'][number]) => p.user_id));
  const nonParticipants = availableUsers.filter((u: AvailableUserRow) => !participantUserIds.has(u.id));
  const availableForAdd = availableTasks.filter((t: AvailableTaskRow) => !contest.tasks.find((ct: ContestDetailRow['tasks'][number]) => ct.id === t.id));

  return (
    <div className="space-y-6">
      <ContestDetailHeader name={contest.name} description={contest.description} isActive={contest.is_active} saving={s.saving} canEdit={canUpdate} onSetActive={s.handleSetActive} onSave={s.handleSave} onEdit={() => setIsEditOpen(true)} />
      <ContestStatusCard contest={contest} formData={{ start: s.formData.start, stop: s.formData.stop, analysis_start: s.formData.analysis_start, analysis_stop: s.formData.analysis_stop }} onChange={(p) => s.setFormData({ ...s.formData, ...p })} />
      <ContestParticipantsSection participations={contest.participations} expanded={s.expandedSections.participants} onToggle={() => s.toggleSection('participants')} onAddParticipant={() => s.setIsParticipantModalOpen(true)} onAddTeam={() => s.setIsTeamModalOpen(true)} onMarkAsTest={s.handleMarkAsTest} onOpenSettings={s.handleOpenParticipationSettings} onRemove={s.handleRemoveParticipant} />
      <ContestTasksSection tasks={contest.tasks} expanded={s.expandedSections.tasks} locale={locale} onToggle={() => s.toggleSection('tasks')} onAddTask={() => s.setIsTaskModalOpen(true)} onRemoveTask={s.handleRemoveTask} />
      <ContestSettingsSection formData={s.formData} expanded={s.expandedSections.info} onToggle={() => s.toggleSection('info')} onChange={(p) => s.setFormData({ ...s.formData, ...p })} />
      <ContestCommunications contestId={contest.id} adminId={user.id} />
      <ParticipantModal isOpen={s.isParticipantModalOpen} onClose={() => s.setIsParticipantModalOpen(false)} contestId={contest.id} availableUsers={nonParticipants} onSuccess={() => router.refresh()} />
      <TaskSelectionModal isOpen={s.isTaskModalOpen} onClose={() => s.setIsTaskModalOpen(false)} contestId={contest.id} availableTasks={availableForAdd} onSuccess={() => router.refresh()} />
      {s.selectedParticipation && <ParticipationModal isOpen={s.isParticipationModalOpen} onClose={() => { s.setIsParticipationModalOpen(false); s.setSelectedParticipation(null); }} participationId={s.selectedParticipation.id} username={s.selectedParticipation.username} teams={teams} onSuccess={() => router.refresh()} />}
      <TeamBulkAddModal isOpen={s.isTeamModalOpen} onClose={() => s.setIsTeamModalOpen(false)} contestId={contest.id} teams={teams} onSuccess={() => router.refresh()} />
      <DeployConfirmModal isOpen={s.showDeployModal} phase={s.deployState.phase} targetLabel={contest.name} onClose={() => { s.setShowDeployModal(false); s.resetDeployState(); }} onConfirm={s.confirmDeploy} />
      <ContestModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} contest={contest as unknown as ExistingContest} onSuccess={() => router.refresh()} permissionKeys={permissionKeys} />
    </div>
  );
}
