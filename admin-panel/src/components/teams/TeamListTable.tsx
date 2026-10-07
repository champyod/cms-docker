'use client';

import { Users } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { RecordList } from '@/components/list/RecordList';
import type { Dictionary } from '@/lib/dictionary';
import type { TeamSummary } from '@/lib/people-read-model-types';

import { TeamRowActions } from './TeamRowActions';
import { buildTeamColumns } from './teamColumns';
import type { TeamCapabilities } from './useTeamListActions';

export type TeamListCopy = Pick<Dictionary['teams'], 'addTeam' | 'tableEmptyTitle' | 'tableEmptyDescription'>;

export interface TeamListTableProps {
  readonly teams: readonly TeamSummary[];
  readonly recordHref: (team: TeamSummary) => string;
  readonly permissionKeys: readonly string[];
  readonly capabilities: TeamCapabilities;
  readonly onEdit: (team: TeamSummary) => void;
  readonly onDelete: (teamId: number) => void;
  readonly onCreate: () => void;
  readonly copy: TeamListCopy;
}

export function TeamListTable({
  teams,
  recordHref,
  permissionKeys,
  capabilities,
  onEdit,
  onDelete,
  onCreate,
  copy,
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
          permissionKeys={permissionKeys}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      emptyState={
        <EmptyState
          icon={Users}
          title={copy.tableEmptyTitle}
          description={copy.tableEmptyDescription}
          actionLabel={capabilities.canCreate ? copy.addTeam : undefined}
          onAction={capabilities.canCreate ? onCreate : undefined}
        />
      }
    />
  );
}
