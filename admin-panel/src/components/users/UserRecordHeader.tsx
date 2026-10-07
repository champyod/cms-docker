'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { getUserEditData } from '@/app/actions/users';
import { Button } from '@/components/core/Button';
import { useRecordTabRefresh } from '@/hooks/useRecordTabRefresh';
import type { Dictionary } from '@/lib/dictionary';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { SafeUser } from '@/lib/prisma-selects';
import { UserModal } from './UserModal';

export type UserRecordHeaderProps = {
  userId: number;
  permissionKeys: readonly string[];
  navigation: Dictionary['navigation'];
};

// Why: the layout already renders the record title, so the header owns only the
// gated edit action — the edit row loads on demand, keeping the header
// summary-only and the layout read unwidened.
export function UserRecordHeader({ userId, permissionKeys, navigation }: UserRecordHeaderProps): React.JSX.Element {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const refresh = useRecordTabRefresh();
  const canEdit = hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.updateUser);

  const openEdit = async (): Promise<void> => {
    const row = await getUserEditData(userId);
    if (!row) return;
    setEditUser(row);
    setIsEditOpen(true);
  };

  const closeEdit = (): void => {
    setIsEditOpen(false);
    setEditUser(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canEdit && (
        <Button variant="secondary" icon={Pencil} onClick={() => { void openEdit(); }}>
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
