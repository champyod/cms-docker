'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Edit2, Plus, Settings, Trash2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

/** The control capabilities of the signed-in admin, resolved on the server from their effective keys. */
export interface AdminCapabilities {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canSetPassword: boolean;
  canRevealPassword: boolean;
}

export interface AdminPanelLabels {
  title: string;
  addAdmin: string;
  expand: string;
  collapse: string;
}

/** Whether the caller may operate the admin control surface at all. */
export function hasAdminControl(capabilities: AdminCapabilities): boolean {
  return (
    capabilities.canCreate ||
    capabilities.canUpdate ||
    capabilities.canDelete ||
    capabilities.canSetPassword
  );
}

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
}: AdminRowActionsProps) {
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

interface AdminPanelCardProps {
  capabilities: AdminCapabilities;
  labels: AdminPanelLabels;
  onAdd: () => void;
  children: ReactNode;
}

/** Collapsible control surface holding the admin management controls and the table they act on. */
export function AdminPanelCard({ capabilities, labels, onAdd, children }: AdminPanelCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 p-4">
        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-label={expanded ? labels.collapse : labels.expand}
          onClick={() => setExpanded((current) => !current)}
          className="h-auto min-w-0 justify-start gap-3 px-2 text-left"
        >
          <Settings className="w-5 h-5 shrink-0 text-primary" />
          <span className="font-bold text-foreground">{labels.title}</span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
        </Button>
        {expanded && capabilities.canCreate && (
          <Button variant="positive" onClick={onAdd}>
            <Plus className="w-4 h-4" />
            {labels.addAdmin}
          </Button>
        )}
      </div>
      {expanded && <div className="border-t border-border p-4">{children}</div>}
    </Card>
  );
}
