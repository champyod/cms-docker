'use client';

import { Pencil, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { RowActionLink } from '@/components/list/RowActionLink';
import type { TeamSummary } from '@/lib/people-read-model-types';

export interface TeamRowActionsProps {
  readonly team: TeamSummary;
  readonly recordHref: string;
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly onEdit: (team: TeamSummary) => void;
  readonly onDelete: (teamId: number) => void;
}

export function TeamRowActions({
  team,
  recordHref,
  canManage,
  canDelete,
  onEdit,
  onDelete,
}: TeamRowActionsProps): React.JSX.Element {
  return (
    // Why the wrapper: the row itself opens the record, so every control that
    // does something else has to stop the click before it reaches the row.
    <span className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
      <RowActionLink href={recordHref} label="View team members" icon={<Users />} isPrimary />
      {canManage && (
        <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit team" onClick={() => onEdit(team)} />
      )}
      {canDelete && (
        <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => onDelete(team.id)} />
      )}
    </span>
  );
}
