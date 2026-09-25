'use client';

import { useMemo, useState } from 'react';
import type { ContestParticipantsData } from '@/lib/queries/contest-detail';
import { ParticipantModal } from '../ParticipantModal';
import { ParticipationModal } from '../ParticipationModal';
import { TeamBulkAddModal } from '../TeamBulkAddModal';
import { ContestParticipantsSection } from './ContestParticipantsSection';
import { useTabRefresh } from './useContestSettingsState';
import { useContestParticipantActions } from './useContestParticipantActions';

export type ContestParticipantsTabProps = { data: ContestParticipantsData };

type ParticipantActions = ReturnType<typeof useContestParticipantActions>;

// Why: the invite picker must not offer users already participating — the
// reader returns every invitable user, so the tab excludes members itself.
function useInviteCandidates(data: ContestParticipantsData): ContestParticipantsData['availableUsers'] {
  const participantUserIds = useMemo(
    () => new Set(data.participations.map((participation) => participation.user_id)),
    [data],
  );
  return useMemo(
    () => data.availableUsers.filter((user) => !participantUserIds.has(user.id)),
    [data, participantUserIds],
  );
}

// Why: the section renders usernames itself with a fallback for rows whose
// user relation is null — the tab passes every row through untouched.
function useSectionParticipations(data: ContestParticipantsData): { id: number; user_id: number; unrestricted: boolean; hidden: boolean; users: { username: string; first_name: string; last_name: string } | null; teams?: { code: string } | null }[] {
  return useMemo(
    () => data.participations.map((participation) => ({
      id: participation.id,
      user_id: participation.user_id,
      unrestricted: participation.unrestricted,
      hidden: participation.hidden,
      users: participation.user,
      teams: participation.team,
    })),
    [data],
  );
}

function ParticipantDialogs({ data, inviteCandidates, actions, onSuccess }: {
  data: ContestParticipantsData;
  inviteCandidates: ContestParticipantsData['availableUsers'];
  actions: ParticipantActions;
  onSuccess: () => void;
}): React.JSX.Element {
  return (
    <>
      {actions.isParticipantModalOpen && (
        <ParticipantModal
          isOpen
          onClose={() => actions.setIsParticipantModalOpen(false)}
          contestId={data.contestId}
          availableUsers={[...inviteCandidates]}
          onSuccess={onSuccess}
        />
      )}
      {actions.isTeamModalOpen && (
        <TeamBulkAddModal
          isOpen
          onClose={() => actions.setIsTeamModalOpen(false)}
          contestId={data.contestId}
          teams={[...data.teams]}
          onSuccess={onSuccess}
        />
      )}
      {actions.selectedParticipation && (
        <ParticipationModal
          isOpen={actions.isParticipationModalOpen}
          onClose={actions.closeParticipationModal}
          participationId={actions.selectedParticipation.id}
          username={actions.selectedParticipation.username}
          teams={[...data.teams]}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}

export function ContestParticipantsTab({ data }: ContestParticipantsTabProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const actions = useContestParticipantActions();
  const refresh = useTabRefresh();
  const inviteCandidates = useInviteCandidates(data);
  const sectionParticipations = useSectionParticipations(data);

  return (
    <div className="space-y-6">
      <ContestParticipantsSection
        participations={sectionParticipations}
        expanded={expanded}
        permissionKeys={data.permissionKeys}
        onToggle={() => setExpanded((previous) => !previous)}
        onAddParticipant={() => actions.setIsParticipantModalOpen(true)}
        onAddTeam={() => actions.setIsTeamModalOpen(true)}
        onMarkAsTest={(participationId) => { void actions.handleMarkAsTest(participationId); }}
        onOpenSettings={(participationId, username) => actions.handleOpenParticipationSettings(participationId, username)}
        onRemove={(participationId) => { void actions.handleRemoveParticipant(participationId); }}
      />
      <ParticipantDialogs data={data} inviteCandidates={inviteCandidates} actions={actions} onSuccess={refresh} />
    </div>
  );
}
