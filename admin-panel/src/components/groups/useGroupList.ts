'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/providers/ToastProvider';
import {
  hasEffectivePermission,
  resolveEffectivePermissions,
} from '@/lib/permission-engine';
import { createGroup, updateGroup, deleteGroup } from '@/app/actions/groups';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import { groupPermissionsByModule } from './groupPermissions';
import { EMPTY_FORM, type GroupFormData } from './groupListTypes';

export function useGroupList(permissionKeys: readonly string[]) {
  const router = useRouter();
  const toast = useToast();
  const effective = useMemo(
    () => new Set(permissionKeys),
    [permissionKeys],
  );

  const canCreate = hasEffectivePermission(effective, 'group:create');
  const canUpdate = hasEffectivePermission(effective, 'group:update');
  const canDelete = hasEffectivePermission(effective, 'group:delete');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] =
    useState<GroupWithPermissions | null>(null);
  const [formData, setFormData] = useState<GroupFormData>(EMPTY_FORM);
  const [deleteReason, setDeleteReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const groupedPermissions = useMemo(
    () => groupPermissionsByModule(),
    [],
  );

  // Why: preview is derived from selected permission keys with no overrides, so it updates instantly while editing.
  const effectivePreview = useMemo(
    () => resolveEffectivePermissions(formData.permissionKeys, []),
    [formData.permissionKeys],
  );

  const handleOpenCreate = useCallback(() => {
    setSelectedGroup(null);
    setFormData(EMPTY_FORM);
    setError('');
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback(
    (group: GroupWithPermissions) => {
      setSelectedGroup(group);
      setFormData({
        name: group.name,
        description: group.description ?? '',
        permissionKeys: [...group.permissionKeys],
        reason: '',
      });
      setError('');
      setIsModalOpen(true);
    },
    [],
  );

  const handleOpenDelete = useCallback(
    (group: GroupWithPermissions) => {
      setSelectedGroup(group);
      setDeleteReason('');
      setError('');
      setIsDeleteOpen(true);
    },
    [],
  );

  const handleTogglePermission = useCallback(
    (key: string, checked: boolean) => {
      setFormData((prev) => ({
        ...prev,
        permissionKeys: checked
          ? [...prev.permissionKeys, key]
          : prev.permissionKeys.filter((k) => k !== key),
      }));
    },
    [],
  );

  const handleToggleModule = useCallback(
    (moduleKeys: readonly string[], checked: boolean) => {
      setFormData((prev) => {
        const current = new Set(prev.permissionKeys);
        for (const key of moduleKeys) {
          if (checked) current.add(key);
          else current.delete(key);
        }
        return { ...prev, permissionKeys: Array.from(current) };
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) {
      setError('Group name is required');
      return;
    }
    if (!formData.reason.trim()) {
      setError('A reason is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = selectedGroup
        ? await updateGroup(
            selectedGroup.id,
            formData.name,
            formData.description,
            formData.permissionKeys,
            formData.reason,
          )
        : await createGroup(
            formData.name,
            formData.description,
            formData.permissionKeys,
            formData.reason,
          );

      if (!result.success) {
        setError(result.error);
        return;
      }

      toast.addToast({
        type: 'success',
        title: selectedGroup ? 'Group updated' : 'Group created',
      });
      setIsModalOpen(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Operation failed',
      );
    } finally {
      setLoading(false);
    }
  }, [formData, selectedGroup, router, toast]);

  const handleDelete = useCallback(async () => {
    if (!selectedGroup) return;
    if (!deleteReason.trim()) {
      setError('A reason is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await deleteGroup(selectedGroup.id, deleteReason);
      if (!result.success) {
        setError(result.error);
        return;
      }

      toast.addToast({ type: 'success', title: 'Group deleted' });
      setIsDeleteOpen(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Delete failed',
      );
    } finally {
      setLoading(false);
    }
  }, [selectedGroup, deleteReason, router, toast]);

  return {
    canCreate,
    canUpdate,
    canDelete,
    isModalOpen,
    setIsModalOpen,
    isDeleteOpen,
    setIsDeleteOpen,
    selectedGroup,
    formData,
    setFormData,
    deleteReason,
    setDeleteReason,
    loading,
    error,
    groupedPermissions,
    effectivePreview,
    handleOpenCreate,
    handleOpenEdit,
    handleOpenDelete,
    handleTogglePermission,
    handleToggleModule,
    handleSave,
    handleDelete,
  };
}

export type UseGroupListReturn = ReturnType<typeof useGroupList>;
