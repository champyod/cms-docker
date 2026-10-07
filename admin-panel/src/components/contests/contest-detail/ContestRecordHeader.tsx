'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Power, Rocket } from 'lucide-react';
import { hasEffectivePermission, ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { getContestEditData } from '@/app/actions/contests';
import { useDeployContest, type DeployPhase } from '@/hooks/useDeployContest';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { useRecordTabRefresh } from '@/hooks/useRecordTabRefresh';
import { ContestModal } from '../ContestModal';
import type { ExistingContest } from '../contest-modal/types';
import { DeployConfirmModal } from '../DeployConfirmModal';

export type ContestRecordHeaderProps = {
  contestId: number;
  name: string;
  description: string;
  isActive: boolean;
  permissionKeys: readonly string[];
};

// Why: the layout already renders the record title and description, so the
// header owns only the status badge and the gated Edit / Set Active actions.
function useRecordEdit(contestId: number): {
  isEditOpen: boolean;
  editContest: ExistingContest | null;
  closeEdit: () => void;
  openEdit: () => Promise<void>;
} {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editContest, setEditContest] = useState<ExistingContest | null>(null);

  const openEdit = async (): Promise<void> => {
    const editData = await getContestEditData(contestId);
    if (!editData) return;
    setEditContest(editData.contest as unknown as ExistingContest);
    setIsEditOpen(true);
  };

  return { isEditOpen, editContest, closeEdit: () => setIsEditOpen(false), openEdit };
}

function useRecordDeploy(contestId: number): {
  showDeployModal: boolean;
  deployPhase: DeployPhase;
  requestDeploy: () => void;
  closeDeploy: () => void;
  confirmDeploy: () => void;
} {
  const [showDeployModal, setShowDeployModal] = useState(false);
  const { state: deployState, deploy, reset } = useDeployContest();
  const refresh = useRecordTabRefresh();

  useEffect(() => {
    if (deployState.phase === 'completed') refresh();
    if (deployState.phase === 'completed' || deployState.phase === 'failed' || deployState.phase === 'timeout' || deployState.phase === 'already_running') {
      queueMicrotask((): void => setShowDeployModal(false));
    }
  }, [deployState.phase, refresh]);

  const requestDeploy = (): void => {
    if (deployState.phase !== 'deploying' && deployState.phase !== 'polling') reset();
    setShowDeployModal(true);
  };

  return {
    showDeployModal,
    deployPhase: deployState.phase,
    requestDeploy,
    closeDeploy: () => { setShowDeployModal(false); reset(); },
    confirmDeploy: () => { void deploy(contestId); },
  };
}

function useRecordHeaderState(contestId: number, permissionKeys: readonly string[]): {
  canEdit: boolean;
  canDeploy: boolean;
  isEditOpen: boolean;
  editContest: ExistingContest | null;
  closeEdit: () => void;
  openEdit: () => Promise<void>;
  showDeployModal: boolean;
  deployPhase: DeployPhase;
  requestDeploy: () => void;
  closeDeploy: () => void;
  confirmDeploy: () => void;
} {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const edit = useRecordEdit(contestId);
  const deploy = useRecordDeploy(contestId);

  return {
    canEdit: hasEffectivePermission(effective, ACTION_PERMISSIONS.updateContest),
    canDeploy: hasEffectivePermission(effective, ACTION_PERMISSIONS.deployContest),
    ...edit,
    ...deploy,
  };
}

export function ContestRecordHeader({ contestId, name, isActive, permissionKeys }: ContestRecordHeaderProps): React.JSX.Element {
  const header = useRecordHeaderState(contestId, permissionKeys);
  const refresh = useRecordTabRefresh();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {isActive && (
        <Badge>
          <Rocket className="h-3 w-3" />
          Active Contest
        </Badge>
      )}
      {header.canEdit && (
        <Button variant="secondary" icon={Pencil} onClick={() => { void header.openEdit(); }}>
          Edit Contest
        </Button>
      )}
      {!isActive && header.canDeploy && (
        <Button variant="positiveOutline" icon={Power} iconOnly tooltip="Set as Active Contest" onClick={header.requestDeploy} />
      )}
      {header.isEditOpen && header.editContest && (
        <ContestModal
          isOpen
          onClose={header.closeEdit}
          contest={header.editContest}
          onSuccess={refresh}
          permissionKeys={permissionKeys}
        />
      )}
      <DeployConfirmModal
        isOpen={header.showDeployModal}
        phase={header.deployPhase}
        targetLabel={name}
        onClose={header.closeDeploy}
        onConfirm={header.confirmDeploy}
      />
    </div>
  );
}
