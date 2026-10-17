'use client';

import type { UsersPageRow } from '@/lib/prisma-selects';

import { UserTable } from './UserTable';
import type { UserListRows } from './useUserListRows';
import type { UserSelection } from './useUserSelection';

export interface UserListTableProps {
  readonly rows: UserListRows;
  readonly selection: UserSelection;
  readonly permissionKeys: readonly string[];
  readonly selectAllLabel: string;
  readonly onOpen: (user: UsersPageRow) => void;
  readonly onEdit: (user: UsersPageRow) => void;
  readonly onDelete: (userId: number) => void;
}

// Why the wiring lives here: the table contract has eleven props, and passing
// them from the shell would bury the list's own composition.
export function UserListTable({ rows, selection, permissionKeys, selectAllLabel, onOpen, onEdit, onDelete }: UserListTableProps) {
  // Why the header cell walks `filteredIds` and not `users`: the list reads every id the applied
  // search matches, so one click covers the whole filter rather than the page on screen.
  const allSelected = rows.filteredIds.length > 0 && rows.filteredIds.every((id) => selection.selectedIds.has(id));
  const partlySelected = rows.filteredIds.some((id) => selection.selectedIds.has(id));
  const toggleAll = (checked: boolean): void => {
    if (checked) selection.setMany(rows.filteredIds, true);
    else selection.clear();
  };

  return (
    <UserTable
      users={rows.users}
      loading={rows.loading}
      selectedIds={selection.selectedIds}
      permissionKeys={permissionKeys}
      pageNumber={rows.table.page}
      perPage={rows.table.perPage}
      allSelected={allSelected}
      partlySelected={partlySelected}
      selectAllLabel={selectAllLabel}
      onToggleAll={toggleAll}
      onToggleOne={selection.toggleOne}
      onOpen={onOpen}
      onEdit={onEdit}
      onDelete={onDelete}
      sort={rows.sort}
      onSortChange={rows.setSort}
    />
  );
}
