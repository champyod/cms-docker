'use client';

import type { Dictionary } from '@/lib/dictionary';
import type { UsersPageRow } from '@/lib/prisma-selects';

import { UserBulkCreateCsv } from './UserBulkCreateCsv';
import { UserBulkEditDialog } from './UserBulkEditDialog';
import { UserModal } from './UserModal';
import type { UserCapabilities, UserDialogs } from './useUserListActions';

export interface UserListDialogsProps {
  readonly dialogs: UserDialogs;
  readonly capabilities: UserCapabilities;
  readonly selectedUsers: UsersPageRow[];
  readonly contests: Array<{ id: number; name: string }>;
  readonly canReadContests: boolean;
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly onSaved: () => void;
}

export function UserListDialogs(props: UserListDialogsProps): React.JSX.Element {
  const { dialogs, capabilities, selectedUsers, contests, canReadContests, permissionKeys, navigation, onSaved } = props;
  return (
    <>
      <UserModal
        isOpen={dialogs.isOpen}
        onClose={dialogs.close}
        user={dialogs.selectedUser}
        contests={contests}
        canReadContests={canReadContests}
        navigation={navigation}
        onSuccess={onSaved}
        permissionKeys={permissionKeys}
      />
      {capabilities.canCreate && (
        <UserBulkCreateCsv
          isOpen={dialogs.isBulkCreateOpen}
          onClose={dialogs.closeBulkCreate}
          contests={contests}
          canReadContests={canReadContests}
          navigation={navigation}
          onSuccess={onSaved}
        />
      )}
      {capabilities.canManage && (
        <UserBulkEditDialog
          isOpen={dialogs.isBulkEditOpen}
          onClose={dialogs.closeBulkEdit}
          selectedUsers={selectedUsers}
          contests={contests}
          canReadContests={canReadContests}
          navigation={navigation}
          onSuccess={onSaved}
        />
      )}
    </>
  );
}
