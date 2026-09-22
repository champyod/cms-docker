'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { ContestModal } from './ContestModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { ContestListHeader } from './contest-list/ContestListHeader';
import { ContestRowActions, buildContestColumns, getContestRowClassName, type ContestRowData } from './contest-list/ContestTableRows';
import { useContestListActions } from './contest-list/useContestListActions';
import type { ExistingContest } from './contest-modal/types';
import { hasEffectivePermission } from '@/lib/permission-engine';

interface ContestListProps {
  initialContests: ContestRowData[];
  totalPages: number;
  permissionKeys: readonly string[];
}

interface ContestPermissions {
  canCreate: boolean;
  canDelete: boolean;
  canSwitch: boolean;
}

function resolveContestPermissions(permissionKeys: readonly string[]): ContestPermissions {
  const effective = new Set(permissionKeys);
  return {
    canCreate: hasEffectivePermission(effective, 'contest:create'),
    canDelete: hasEffectivePermission(effective, 'contest:delete'),
    canSwitch: hasEffectivePermission(effective, 'contest:switch'),
  };
}

export function ContestList({ initialContests, totalPages, permissionKeys }: ContestListProps): React.JSX.Element {
  void totalPages;
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedContest] = useState<ExistingContest | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const actions = useContestListActions();
  const permissions = useMemo(() => resolveContestPermissions(permissionKeys), [permissionKeys]);

  const handleCreate = () => { if (!permissions.canCreate) return; setIsModalOpen(true); };
  const handleSuccess = () => window.location.reload();
  const handleOpenContest = useCallback((id: number) => {
    router.push(`/${locale}/contests/${id}`);
  }, [router, locale]);

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(() => buildContestColumns(handleOpenContest), [handleOpenContest]);

  const renderRowActions = useCallback((contest: ContestRowData) => (
    <ContestRowActions contest={contest} isSuperAdmin={permissions.canSwitch} canManage={permissions.canDelete} onSetActive={actions.requestDeploy} />
  ), [permissions.canSwitch, permissions.canDelete, actions.requestDeploy]);

  return (
    <div className="space-y-6">
      <ContestListHeader locale={locale} canManage={permissions.canCreate} onCreate={handleCreate} />
      <ResponsiveTable
        columns={columns}
        rows={contests}
        getRowKey={(contest) => contest.id}
        getRowClassName={getContestRowClassName}
        renderRowActions={renderRowActions}
        emptyState={
          <EmptyState icon={Trophy} title="No contests found" description="Create your first contest to get started." />
        }
      />
      <ContestModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} contest={selectedContest} onSuccess={handleSuccess} permissionKeys={permissionKeys} />
      <DeployConfirmModal isOpen={actions.deployTarget !== null} phase={actions.deployState.phase} targetLabel={`#${actions.deployTarget}`} extraNote="The previous active contest will be deactivated." onClose={actions.closeDeploy} onConfirm={actions.confirmDeploy} />
    </div>
  );
}
