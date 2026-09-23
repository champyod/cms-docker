'use client';

import { useMemo, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { Text } from '@/components/core/Typography';
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
  const {
    canCreate,
    canUpdate,
    canDelete,
    handleOpenCreate,
    handleOpenEdit,
    handleOpenDelete,
  } = list;

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(() => buildColumns(dict), [dict]);

  const renderRowActions = useCallback(
    (group: GroupWithPermissions) => (
      <>
        {canUpdate && (
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            iconOnly
            tooltip={dict.editTooltip}
            className="min-h-11 min-w-11"
            onClick={() => handleOpenEdit(group)}
          />
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            iconOnly
            tooltip={dict.deleteTooltip}
            className="min-h-11 min-w-11"
            onClick={() => handleOpenDelete(group)}
          />
        )}
      </>
    ),
    [canUpdate, canDelete, dict, handleOpenEdit, handleOpenDelete],
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <Text variant="h2">{dict.title}</Text>
        {canCreate && (
          <Button variant="positive" icon={Plus} onClick={handleOpenCreate}>
            {dict.createGroup}
          </Button>
        )}
      </div>

      <ResponsiveTable
        columns={columns}
        rows={groups}
        getRowKey={(group) => group.id}
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
