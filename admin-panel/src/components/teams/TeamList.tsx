'use client';

import { usePathname } from 'next/navigation';

import { useAppRouter } from '@/hooks/useAppRouter';
import { useSyncedState } from '@/hooks/useSyncedState';
import { buildRoute } from '@/lib/navigation/routes';
import type { TeamSummary } from '@/lib/people-read-model-types';

import { TeamListHeader } from './TeamListHeader';
import { TeamListTable } from './TeamListTable';
import { TeamModal } from './TeamModal';
import type { TeamListProps } from './teamListTypes';
import { useTeamCapabilities, useTeamDelete, useTeamDialogs } from './useTeamListActions';

function recordHref(locale: string, team: TeamSummary): string {
  return buildRoute(locale, 'people.team-record', { id: team.id });
}

export function TeamList({ initialTeams, permissionKeys, navigation, copy, docsLinkLabel }: TeamListProps): React.JSX.Element {
  const [teams] = useSyncedState(initialTeams);
  const dialogs = useTeamDialogs();
  const pathname = usePathname();
  const router = useAppRouter();
  const locale = pathname.split('/')[1] || 'en';
  const capabilities = useTeamCapabilities(permissionKeys);
  const removeTeam = useTeamDelete(capabilities.canDelete, () => router.refresh());
  const startEdit = (team: TeamSummary): void => {
    if (capabilities.canManage) dialogs.openEdit(team);
  };

  return (
    <div className="space-y-6">
      <TeamListHeader locale={locale} canCreate={capabilities.canCreate} onCreate={dialogs.openCreate} copy={copy} docsLinkLabel={docsLinkLabel} />
      <TeamListTable
        teams={teams}
        recordHref={(team) => recordHref(locale, team)}
        capabilities={capabilities}
        onEdit={startEdit}
        onDelete={(teamId) => { void removeTeam(teamId); }}
        onCreate={dialogs.openCreate}
        copy={copy}
      />
      <TeamModal
        isOpen={dialogs.isOpen}
        onClose={dialogs.close}
        onSuccess={() => router.refresh()}
        initialData={dialogs.editingTeam}
        permissionKeys={permissionKeys}
        navigation={navigation}
      />
    </div>
  );
}
