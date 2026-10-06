'use client';

import { useAppRouter } from '@/hooks/useAppRouter';
import { buildRoute } from '@/lib/navigation/routes';
import type { UsersPageRow } from '@/lib/prisma-selects';

import { UserBulkEditDialog } from './UserBulkEditDialog';
import { UserListPagination } from './UserListPagination';
import { UserListTable } from './UserListTable';
import { UserSearchToolbar } from './UserSearchToolbar';
import type { UserListProps } from './userTableTypes';
import { useUserCapabilities, useUserDelete, useUserDialogs } from './useUserListActions';
import { useRegisterUserListRefresh } from './useUserListRefresh';
import { useUserListRows } from './useUserListRows';
import { useUserSelection } from './useUserSelection';

export function UserList({ initialUsers, totalPages, currentPage, perPage, initialSearch, contests, canReadContests, navigation, permissionKeys, locale }: UserListProps): React.JSX.Element {
  const rows = useUserListRows({ initialUsers, totalPages, currentPage, perPage, initialSearch });
  const selection = useUserSelection(rows.users, rows.userCache);
  const capabilities = useUserCapabilities(permissionKeys);
  const dialogs = useUserDialogs();
  const router = useAppRouter();
  const refresh = () => { void rows.fetchUsers(); };
  const removeUser = useUserDelete(capabilities.canDelete, refresh);
  // Why the registration lives here: the create dialogs sit in the page header, in a
  // different client tree, so this is the only holder of the fetch that knows the
  // current page and search, and the only place a header-owned save can come back to.
  useRegisterUserListRefresh(refresh);

  return (
    <div className="space-y-6">
      <UserSearchToolbar rows={rows} canManage={capabilities.canManage} selectedCount={selection.selectedIds.size} onBulkEdit={dialogs.openBulkEdit} />
      <UserListTable
        rows={rows}
        selection={selection}
        permissionKeys={permissionKeys}
        onOpen={(user: UsersPageRow) => router.push(buildRoute(locale, 'people.user-record', { id: user.id }))}
        onEdit={dialogs.openEdit}
        onDelete={(userId) => { void removeUser(userId); }}
      />
      <UserListPagination rows={rows} />
      {capabilities.canManage && (
        <UserBulkEditDialog
          isOpen={dialogs.isBulkEditOpen}
          onClose={dialogs.closeBulkEdit}
          selectedUsers={selection.selectedUsers}
          contests={contests}
          canReadContests={canReadContests}
          navigation={navigation}
          onSuccess={refresh}
        />
      )}
    </div>
  );
}