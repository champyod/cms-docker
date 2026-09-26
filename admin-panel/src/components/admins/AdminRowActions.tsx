'use client';

import { Pencil, Trash2 } from 'lucide-react';

import { RowActions, rowActionGroupLabel } from '@/components/core/RowActions';
import { useDictionary } from '@/hooks/useDictionary';
import { cn } from '@/lib/utils';
import type { AdminCapabilities } from './adminCapabilities';

interface AdminRowActionsProps {
  capabilities: AdminCapabilities;
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
  capabilities,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  className,
}: AdminRowActionsProps): React.JSX.Element | null {
  const dict = useDictionary();
  // Why: resetting a credential is reachable from the same form as the other fields, so it also opens the row.
  const canEdit = capabilities.canUpdate || capabilities.canSetPassword;
  if (!canEdit && !capabilities.canDelete) return null;

  return (
    <RowActions
      ariaLabel={rowActionGroupLabel(dict, 'admins')}
      className={cn('justify-end gap-2', className)}
      actions={[
        { key: 'edit', label: editLabel, icon: Pencil, onClick: onEdit, isVisible: canEdit, className: 'text-muted-foreground hover:text-primary' },
        { key: 'delete', label: deleteLabel, icon: Trash2, onClick: onDelete, isVisible: capabilities.canDelete, className: 'text-muted-foreground hover:text-destructive' },
      ]}
    />
  );
}
