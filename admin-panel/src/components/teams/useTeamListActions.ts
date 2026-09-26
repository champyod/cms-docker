'use client';

import { useMemo, useState } from 'react';

import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { deleteTeam } from '@/app/actions/teams';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { TeamSummary } from '@/lib/people-read-model-types';

export interface TeamCapabilities {
  readonly canCreate: boolean;
  readonly canManage: boolean;
  readonly canDelete: boolean;
}

export interface TeamDialogs {
  readonly isOpen: boolean;
  readonly editingTeam: TeamSummary | null;
  readonly openCreate: () => void;
  readonly openEdit: (team: TeamSummary) => void;
  readonly close: () => void;
}

export function useTeamCapabilities(permissionKeys: readonly string[]): TeamCapabilities {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  return {
    canCreate: hasEffectivePermission(effective, 'team:create'),
    canManage: hasEffectivePermission(effective, 'team:update'),
    canDelete: hasEffectivePermission(effective, 'team:delete'),
  };
}

// Why the dialog state is its own hook: the create and edit forms are the same
// dialog, so the row action and the header button open one shared surface.
export function useTeamDialogs(): TeamDialogs {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamSummary | null>(null);
  return {
    isOpen,
    editingTeam,
    openCreate: () => { setEditingTeam(null); setIsOpen(true); },
    openEdit: (team: TeamSummary) => { setEditingTeam(team); setIsOpen(true); },
    close: () => { setIsOpen(false); setEditingTeam(null); },
  };
}

// Why the confirmation stays here: a team delete is destructive and
// irreversible, so it keeps its dialog and only re-reads after confirmation.
export function useTeamDelete(canDelete: boolean, onDeleted: () => void): (teamId: number) => Promise<void> {
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();

  return async (teamId: number) => {
    if (!canDelete) return;
    if (!(await confirm(destructiveConfirm('team')))) return;
    const result = await runAction(
      { pending: 'Deleting team...', success: 'Team deleted', failure: 'Delete failed' },
      () => deleteTeam(teamId)
    );
    if (result?.success) onDeleted();
  };
}
