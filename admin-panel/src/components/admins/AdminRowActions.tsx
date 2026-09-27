'use client';

import { Pencil, Trash2 } from 'lucide-react';

import { RowActions, rowActionGroupLabel } from '@/components/core/RowActions';
import { useDictionary } from '@/hooks/useDictionary';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import { cn } from '@/lib/utils';

interface AdminRowActionsProps {
  permissionKeys: readonly string[];
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}

/**
 * The edit/delete controls of a single admin row.
 *
 * Why: the mobile card and the desktop row render the same pair of actions, so both paths share this
 * component and therefore share one set of permission gates.
 */
export function AdminRowActions({
  permissionKeys,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  className,
}: AdminRowActionsProps): React.JSX.Element | null {
  const dict = useDictionary();
  // Why the pair, not one key: `updateAdmin` admits either entry permission, so a caller holding
  // only `setAdminPassword` can still reset a credential through this control.
  const editPermissions = [ACTION_PERMISSIONS.updateAdmin, ACTION_PERMISSIONS.setAdminPassword] as const;
  const effective = new Set(permissionKeys);
  const hasEdit = editPermissions.some((key) => hasEffectivePermission(effective, key));
  if (!hasEdit && !hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteAdmin)) return null;

  return (
    <RowActions
      ariaLabel={rowActionGroupLabel(dict, 'admins')}
      className={cn('justify-end gap-2', className)}
      permissionKeys={permissionKeys}
      actions={[
        { key: 'edit', label: editLabel, icon: Pencil, onClick: onEdit, permission: editPermissions, className: 'text-muted-foreground hover:text-primary' },
        { key: 'delete', label: deleteLabel, icon: Trash2, onClick: onDelete, permission: ACTION_PERMISSIONS.deleteAdmin, className: 'text-muted-foreground hover:text-destructive' },
      ]}
    />
  );
}
