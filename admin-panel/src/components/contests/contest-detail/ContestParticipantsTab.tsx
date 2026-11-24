'use client';

import { useDictionary } from '@/hooks/useDictionary';
import { useMemo } from 'react';
import type { ContestParticipantsData } from '@/lib/queries/contest-detail';
import { ParticipantModal } from '../ParticipantModal';
import { ParticipationModal } from '../ParticipationModal';
import { TeamBulkAddModal } from '../TeamBulkAddModal';
import { ContestParticipantsSection } from './ContestParticipantsSection';
import { useTabRefresh } from './useContestSettingsState';
import { useContestParticipantActions } from './useContestParticipantActions';

export type ContestParticipantsTabProps = { data: ContestParticipantsData };

type ParticipantActions = ReturnType<typeof useContestParticipantActions>;

// The reader returns every invitable user, so the tab excludes members itself.
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

// The section renders usernames itself with a fallback for null user rows.
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

/** A roster row is a team's registration override, not a participation, so it is a section of its own. */
export function ContestParticipantsTab({ data }: ContestParticipantsTabProps): React.JSX.Element {
  const participantsCopy = useDictionary().contests.participants;
  const actions = useContestParticipantActions();
  const refresh = useTabRefresh();
  const inviteCandidates = useInviteCandidates(data);
  const sectionParticipations = useSectionParticipations(data);

  return (
    <>
      <ContestParticipantsSection
        participations={sectionParticipations}
        permissionKeys={data.permissionKeys}
        onAddParticipant={() => actions.setIsParticipantModalOpen(true)}
        onAddTeam={() => actions.setIsTeamModalOpen(true)}
        onMarkAsTest={(participationId) => { void actions.handleMarkAsTest(participationId); }}
        onOpenSettings={(participationId, username) => actions.handleOpenParticipationSettings(participationId, username)}
        onRemove={(participationId) => { void actions.handleRemoveParticipant(participationId); }}
        copy={participantsCopy}
      />
      <ParticipantDialogs data={data} inviteCandidates={inviteCandidates} actions={actions} onSuccess={refresh} />
    </>
  );
}
