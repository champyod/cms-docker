'use client';

import { Pencil, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { RowActionLink } from '@/components/list/RowActionLink';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { TeamSummary } from '@/lib/people-read-model-types';

export interface TeamRowActionsProps {
  readonly team: TeamSummary;
  readonly recordHref: string;
  readonly permissionKeys: readonly string[];
  readonly onEdit: (team: TeamSummary) => void;
  readonly onDelete: (teamId: number) => void;
}

export function TeamRowActions({
  team,
  recordHref,
  permissionKeys,
  onEdit,
  onDelete,
}: TeamRowActionsProps): React.JSX.Element {
  const effective = new Set(permissionKeys);
  return (
    // Why the wrapper: the row itself opens the record, so every control that
    // does something else has to stop the click before it reaches the row.
    <span className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
      <RowActionLink href={recordHref} label="View team members" icon={<Users />} isPrimary />
      {hasEffectivePermission(effective, ACTION_PERMISSIONS.updateTeam) && (
        <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit team" onClick={() => onEdit(team)} />
      )}
      {hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteTeam) && (
        <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => onDelete(team.id)} />
      )}
    </span>
  );
}
