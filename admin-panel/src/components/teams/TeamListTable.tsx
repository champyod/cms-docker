'use client';

import { Users } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { RecordList } from '@/components/list/RecordList';
import { useDictionary } from '@/hooks/useDictionary';
import type { ListSortInput } from '@/lib/list-sorting';
import type { Dictionary } from '@/lib/dictionary';
import type { TeamSummary } from '@/lib/people-read-model-types';

import { TeamRowActions } from './TeamRowActions';
import { buildTeamColumns } from './teamColumns';

export type TeamListCopy = Pick<Dictionary['teams'], 'addTeam' | 'tableEmptyTitle' | 'tableEmptyDescription'>;

export interface TeamListTableProps {
  readonly teams: readonly TeamSummary[];
  readonly recordHref: (team: TeamSummary) => string;
  readonly permissionKeys: readonly string[];
  readonly onEdit: (team: TeamSummary) => void;
  readonly onDelete: (teamId: number) => void;
  readonly copy: TeamListCopy;
  readonly sort?: ListSortInput;
  readonly onSortChange?: (sort: ListSortInput) => void;
}

export function TeamListTable({
  teams,
  recordHref,
  permissionKeys,
  onEdit,
  onDelete,
  copy,
  sort,
  onSortChange,
}: TeamListTableProps): React.JSX.Element {
  const dict = useDictionary();
  return (
    <RecordList
      rows={teams}
      columns={buildTeamColumns(dict.common.notSet)}
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
        />
      }
      sort={sort}
      onSortChange={onSortChange}
    />
  );
}
