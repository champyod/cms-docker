'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { getTeamEditData } from '@/app/actions/teams';
import { Button } from '@/components/core/Button';
// Why: the record-layout refresh registrar is the single router handle every
// record header shares, so the Team header joins it rather than owning a second.
import { useTaskTabRefresh } from '@/components/tasks/task-detail/useTaskTabRefresh';
import type { Dictionary } from '@/lib/dictionary';
import type { TeamEditData } from '@/lib/people-read-models';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import { TeamModal } from './TeamModal';

export type TeamRecordHeaderProps = {
  teamId: number;
  name: string;
  permissionKeys: readonly string[];
  navigation: Dictionary['navigation'];
};

// Why: the layout already renders the record title, so the header owns only the
// gated edit action — the edit record loads on demand, keeping the header
// summary-only and the layout read unwidened.
export function TeamRecordHeader({ teamId, name, permissionKeys, navigation }: TeamRecordHeaderProps): React.JSX.Element {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<TeamEditData | null>(null);
  const refresh = useTaskTabRefresh();
  const canEdit = hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.updateTeam);

  const openEdit = async (): Promise<void> => {
    const record = await getTeamEditData(teamId);
    if (!record) return;
    setEditTeam(record);
    setIsEditOpen(true);
  };

  const closeEdit = (): void => {
    setIsEditOpen(false);
    setEditTeam(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canEdit && (
        <Button variant="secondary" icon={Pencil} onClick={() => { void openEdit(); }} aria-label={`Edit ${name}`}>
          Edit Team
        </Button>
      )}
      {isEditOpen && editTeam && (
        <TeamModal
          isOpen
          onClose={closeEdit}
          initialData={editTeam}
          navigation={navigation}
          onSuccess={refresh}
          permissionKeys={permissionKeys}
        />
      )}
    </div>
  );
}
