'use client';

import { useMemo, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { RowActions, rowActionGroupLabel } from '@/components/core/RowActions';
import { useDictionary } from '@/hooks/useDictionary';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { GroupWithPermissions } from '@/app/actions/adminPermissions';
import { buildColumns } from './groupColumns';
import { useGroupList } from './useGroupList';
import { GroupFormDialog } from './GroupFormDialog';
import { GroupDeleteDialog } from './GroupDeleteDialog';
import type { GroupListProps } from './groupListTypes';

export function GroupList({
  groups,
  permissionKeys,
  dict,
}: GroupListProps): React.JSX.Element {
  const list = useGroupList(permissionKeys);
  // Why the hook, not the prop: the group label lives outside the groups copy
  // block, and only the full dictionary carries it.
  const actionGroupLabel = rowActionGroupLabel(useDictionary(), 'groups');
  const {
    handleOpenCreate,
    handleOpenEdit,
    handleOpenDelete,
  } = list;

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(() => buildColumns(dict), [dict]);

  const renderRowActions = useCallback(
    (group: GroupWithPermissions) => (
      <RowActions
        ariaLabel={actionGroupLabel}
        permissionKeys={permissionKeys}
        actions={[
          { key: 'edit', label: dict.editTooltip, icon: Pencil, onClick: () => handleOpenEdit(group), permission: ACTION_PERMISSIONS.updateGroup, className: 'min-h-11 min-w-11' },
          { key: 'delete', label: dict.deleteTooltip, icon: Trash2, onClick: () => handleOpenDelete(group), permission: ACTION_PERMISSIONS.deleteGroup, className: 'min-h-11 min-w-11' },
        ]}
      />
    ),
    [actionGroupLabel, permissionKeys, dict, handleOpenEdit, handleOpenDelete],
  );

  const getRowProps = useCallback((group: GroupWithPermissions) => (
    hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.updateGroup)
      ? {
        onClick: () => handleOpenEdit(group),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) handleOpenEdit(group);
        },
        tabIndex: 0,
        className: 'cursor-pointer',
      }
      : undefined
  ), [permissionKeys, handleOpenEdit]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-center">
        {hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.createGroup) && (
          <Button variant="positive" icon={Plus} onClick={handleOpenCreate}>
            {dict.createGroup}
          </Button>
        )}
      </div>

      <ResponsiveTable
        columns={columns}
        rows={groups}
        getRowKey={(group) => group.id}
        getRowProps={getRowProps}
        renderRowActions={renderRowActions}
        emptyState={
          <EmptyState
            title={dict.noGroups}
            description={dict.noGroupsDescription}
          />
        }
      />

      <GroupFormDialog
        open={list.isModalOpen}
        setOpen={list.setIsModalOpen}
        selectedGroup={list.selectedGroup}
        dict={dict}
        formData={list.formData}
        setFormData={list.setFormData}
        groupedPermissions={list.groupedPermissions}
        effectivePreview={list.effectivePreview}
        error={list.error}
        loading={list.loading}
        onTogglePermission={list.handleTogglePermission}
        onToggleModule={list.handleToggleModule}
        onSave={list.handleSave}
      />

      <GroupDeleteDialog
        open={list.isDeleteOpen}
        setOpen={list.setIsDeleteOpen}
        dict={dict}
        error={list.error}
        deleteReason={list.deleteReason}
        setDeleteReason={list.setDeleteReason}
        loading={list.loading}
        onDelete={list.handleDelete}
      />
    </div>
  );
}
