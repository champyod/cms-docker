'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

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

interface UserDialogsState {
  readonly isOpen: boolean;
  readonly isBulkCreateOpen: boolean;
  readonly isBulkEditOpen: boolean;
  readonly selectedUser: UsersPageRow | null;
}

const CLOSED_DIALOGS: UserDialogsState = {
  isOpen: false,
  isBulkCreateOpen: false,
  isBulkEditOpen: false,
  selectedUser: null,
};

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

// Why a module handle, exactly like the refresh handle: the create and edit
// dialogs are opened by the table's rows in one client tree and by the page
// header's buttons in another, so neither can own the state the other opens.
// One handle serves both, and every consumer reads the same flags.
let dialogsState: UserDialogsState = CLOSED_DIALOGS;
const dialogListeners = new Set<() => void>();

function setDialogsState(next: UserDialogsState): void {
  dialogsState = next;
  dialogListeners.forEach((listener) => listener());
}

function subscribeDialogs(listener: () => void): () => void {
  dialogListeners.add(listener);
  return (): void => {
    dialogListeners.delete(listener);
  };
}

export function useUserDialogs(): UserDialogs {
  const state = useSyncExternalStore(subscribeDialogs, () => dialogsState);

  const openCreate = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS, isOpen: true });
  }, []);

  const openEdit = useCallback((user: UsersPageRow): void => {
    setDialogsState({ ...CLOSED_DIALOGS, isOpen: true, selectedUser: user });
  }, []);

  const close = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS, isBulkCreateOpen: dialogsState.isBulkCreateOpen, isBulkEditOpen: dialogsState.isBulkEditOpen });
  }, []);

  const openBulkCreate = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS, isBulkCreateOpen: true });
  }, []);

  const closeBulkCreate = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS });
  }, []);

  const openBulkEdit = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS, isBulkEditOpen: true });
  }, []);

  const closeBulkEdit = useCallback((): void => {
    setDialogsState({ ...CLOSED_DIALOGS });
  }, []);

  return {
    isOpen: state.isOpen,
    isBulkCreateOpen: state.isBulkCreateOpen,
    isBulkEditOpen: state.isBulkEditOpen,
    selectedUser: state.selectedUser,
    openCreate,
    openEdit,
    close,
    openBulkCreate,
    closeBulkCreate,
    openBulkEdit,
    closeBulkEdit,
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
