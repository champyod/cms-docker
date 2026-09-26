'use client';

import { Users } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { RecordList } from '@/components/list/RecordList';
import type { TeamSummary } from '@/lib/people-read-model-types';

import { TeamRowActions } from './TeamRowActions';
import { buildTeamColumns } from './teamColumns';
import type { TeamCapabilities } from './useTeamListActions';

export interface TeamListTableProps {
  readonly teams: readonly TeamSummary[];
  readonly recordHref: (team: TeamSummary) => string;
  readonly capabilities: TeamCapabilities;
  readonly onEdit: (team: TeamSummary) => void;
  readonly onDelete: (teamId: number) => void;
  readonly onCreate: () => void;
}

export function TeamListTable({
  teams,
  recordHref,
  capabilities,
  onEdit,
  onDelete,
  onCreate,
}: TeamListTableProps): React.JSX.Element {
  return (
    <RecordList
      rows={teams}
      columns={buildTeamColumns()}
      getRowKey={(team) => team.id}
      getRecordHref={recordHref}
      renderRowActions={(team) => (
        <TeamRowActions
          team={team}
          recordHref={recordHref(team)}
          canManage={capabilities.canManage}
          canDelete={capabilities.canDelete}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      emptyState={
        <EmptyState
          icon={Users}
          title="No teams found"
          description="Teams will appear here once created."
          actionLabel={capabilities.canCreate ? 'Add Team' : undefined}
          onAction={capabilities.canCreate ? onCreate : undefined}
        />
      }
    />
  );
}
