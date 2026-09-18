'use client';

import { Edit2, Trash2 } from 'lucide-react';

import { Button } from '@/components/core/Button';
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
  // Why: resetting a credential is reachable from the same form as the other fields, so it also opens the row.
  const canEdit = capabilities.canUpdate || capabilities.canSetPassword;
  if (!canEdit && !capabilities.canDelete) return null;

  return (
    <div className={cn('flex items-center justify-end gap-2', className)}>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          tooltip={editLabel}
          onClick={onEdit}
          className="text-muted-foreground hover:text-primary"
        >
          <Edit2 className="w-4 h-4" />
        </Button>
      )}
      {capabilities.canDelete && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          tooltip={deleteLabel}
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
