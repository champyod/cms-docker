'use client';

import type { UsersPageRow } from '@/lib/prisma-selects';

import { UserTable } from './UserTable';
import type { UserListRows } from './useUserListRows';
import type { UserSelection } from './useUserSelection';

export interface UserListTableProps {
  readonly rows: UserListRows;
  readonly selection: UserSelection;
  readonly permissionKeys: readonly string[];
  readonly onOpen: (user: UsersPageRow) => void;
  readonly onEdit: (user: UsersPageRow) => void;
  readonly onDelete: (userId: number) => void;
}

// Why the wiring lives here: the table contract has eleven props, and passing
// them from the shell would bury the list's own composition.
export function UserListTable({ rows, selection, permissionKeys, onOpen, onEdit, onDelete }: UserListTableProps): React.JSX.Element {
  return (
    <UserTable
      users={rows.users}
      loading={rows.loading}
      selectedIds={selection.selectedIds}
      permissionKeys={permissionKeys}
      pageNumber={rows.table.page}
      perPage={rows.table.perPage}
      onToggleAll={selection.toggleAll}
      onToggleOne={selection.toggleOne}
      onOpen={onOpen}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}
