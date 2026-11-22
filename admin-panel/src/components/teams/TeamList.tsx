'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';

import { useAppRouter } from '@/hooks/useAppRouter';
import { useSyncedState } from '@/hooks/useSyncedState';
import type { ListSortInput } from '@/lib/list-sorting';
import { buildRoute } from '@/lib/navigation/routes';
import type { TeamSummary } from '@/lib/people-read-model-types';

import { TeamListTable } from './TeamListTable';
import { TeamModal } from './TeamModal';
import type { TeamListProps } from './teamListTypes';
import { useRegisterTeamListRefresh } from './useTeamListRefresh';
import { useTeamCapabilities, useTeamDelete, useTeamDialogs } from './useTeamListActions';

function recordHref(locale: string, team: TeamSummary): string {
  return buildRoute(locale, 'people.team-record', { id: team.id });
}

export function TeamList({ initialTeams, permissionKeys, navigation, copy, initialSort }: TeamListProps): React.JSX.Element {
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
  // Why the header reloads through this registration: its create dialog renders in the page
  // header, outside this component, and only this component knows the current query.
  const refreshList = useCallback((): void => { router.refresh(); }, [router]);
  useRegisterTeamListRefresh(refreshList);

  const applySort = (next: ListSortInput): void => {
    const params = new URLSearchParams(window.location.search);
    if (next !== null && next !== undefined) {
      params.set('sort', next.key);
      params.set('dir', next.direction);
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    const query = params.toString();
    router.replace(query.length > 0 ? `?${query}` : pathname);
  };

  return (
    <div className="space-y-6">
      <TeamListTable
        teams={teams}
        recordHref={(team) => recordHref(locale, team)}
        permissionKeys={permissionKeys}
        onEdit={startEdit}
        onDelete={(teamId) => { void removeTeam(teamId); }}
        copy={copy}
        sort={initialSort}
        onSortChange={applySort}
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
