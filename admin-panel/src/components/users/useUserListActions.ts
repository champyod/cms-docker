'use client';

import { useMemo, useState } from 'react';

import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { apiClient } from '@/lib/apiClient';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { UsersPageRow } from '@/lib/prisma-selects';

export interface UserCapabilities {
  readonly canCreate: boolean;
  readonly canManage: boolean;
  readonly canDelete: boolean;
}

export interface UserDialogs {
  readonly isOpen: boolean;
  readonly isBulkCreateOpen: boolean;
  readonly isBulkEditOpen: boolean;
  readonly selectedUser: UsersPageRow | null;
  readonly openCreate: () => void;
  readonly openEdit: (user: UsersPageRow) => void;
  readonly close: () => void;
  readonly openBulkCreate: () => void;
  readonly closeBulkCreate: () => void;
  readonly openBulkEdit: () => void;
  readonly closeBulkEdit: () => void;
}

export function useUserCapabilities(permissionKeys: readonly string[]): UserCapabilities {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  return {
    canCreate: hasEffectivePermission(effective, 'user:create'),
    canManage: hasEffectivePermission(effective, ACTION_PERMISSIONS.updateUser),
    canDelete: hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteUser),
  };
}

// Why the dialog state is its own hook: the three dialogs are opened by
// unrelated controls, so their open/close pairs do not belong to the data hook.
export function useUserDialogs(): UserDialogs {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkCreateOpen, setIsBulkCreateOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UsersPageRow | null>(null);
  return {
    isOpen, isBulkCreateOpen, isBulkEditOpen, selectedUser,
    openCreate: () => { setSelectedUser(null); setIsOpen(true); },
    openEdit: (user: UsersPageRow) => { setSelectedUser(user); setIsOpen(true); },
    close: () => { setIsOpen(false); setSelectedUser(null); },
    openBulkCreate: () => { setIsBulkCreateOpen(true); },
    closeBulkCreate: () => { setIsBulkCreateOpen(false); },
    openBulkEdit: () => { setIsBulkEditOpen(true); },
    closeBulkEdit: () => { setIsBulkEditOpen(false); },
  };
}

// Why the confirmation stays: a user delete is destructive and irreversible, so
// it keeps its dialog and only re-reads the list after the API confirms.
export function useUserDelete(canDelete: boolean, onDeleted: () => void): (userId: number) => Promise<void> {
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();

  return async (userId: number) => {
    if (!canDelete) return;
    if (!(await confirm(destructiveConfirm('user')))) return;
    const result = await runAction(
      { pending: 'Deleting user...', success: 'User deleted', failure: 'Failed to delete user' },
      () => apiClient.delete(`/api/users/${userId}`)
    );
    if (result?.success) onDeleted();
  };
}
