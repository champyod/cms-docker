'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { getUserEditData } from '@/app/actions/users';
import { Button } from '@/components/core/Button';
// Why: the record-layout refresh registrar is the single router handle every
// record header shares, so the User header joins it rather than owning a second.
import { useTaskTabRefresh } from '@/components/tasks/task-detail/useTaskTabRefresh';
import type { Dictionary } from '@/lib/dictionary';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { UsersPageRow } from '@/lib/prisma-selects';
import { UserModal } from './UserModal';

export type UserRecordHeaderProps = {
  userId: number;
  username: string;
  permissionKeys: readonly string[];
  navigation: Dictionary['navigation'];
};

// Why: the layout already renders the record title, so the header owns only the
// gated edit action — the edit row loads on demand, keeping the header
// summary-only and the layout read unwidened.
export function UserRecordHeader({ userId, username, permissionKeys, navigation }: UserRecordHeaderProps): React.JSX.Element {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UsersPageRow | null>(null);
  const refresh = useTaskTabRefresh();
  const canEdit = hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.updateUser);

  const openEdit = async (): Promise<void> => {
    const row = await getUserEditData(userId);
    if (!row) return;
    // Why the assertion: UserModal is typed for the list row, but the form reads
    // only the columns this payload carries — the record is the same user, narrower.
    setEditUser(row as unknown as UsersPageRow);
    setIsEditOpen(true);
  };

  const closeEdit = (): void => {
    setIsEditOpen(false);
    setEditUser(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canEdit && (
        <Button variant="secondary" icon={Pencil} onClick={() => { void openEdit(); }} aria-label={`Edit ${username}`}>
          Edit User
        </Button>
      )}
      {isEditOpen && editUser && (
        <UserModal
          isOpen
          onClose={closeEdit}
          user={editUser}
          canReadContests={false}
          navigation={navigation}
          onSuccess={refresh}
          permissionKeys={permissionKeys}
        />
      )}
    </div>
  );
}
