'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePathname, useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { ContestModal } from './ContestModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { ContestListHeader } from './contest-list/ContestListHeader';
import { ContestRowActions, buildContestColumns, getContestRowClassName, getContestRowProps, type ContestRowData } from './contest-list/ContestTableRows';
import { ContestBulkEditDialog } from './contest-list/ContestBulkEditDialog';
import { useContestListActions } from './contest-list/useContestListActions';
import { Button } from '@/components/core/Button';
import { BulkActionBar } from '@/components/core/BulkActionBar';
import { ApplyLimitsButton } from '@/components/limits/ApplyLimitsButton';
import { buildSelectionColumn } from '@/components/core/SelectionColumn';
import { useListSelection } from '@/hooks/useListSelection';
import { useDictionary } from '@/hooks/useDictionary';
import { unsetLimitPatch } from '@/lib/limit-patch';
import type { ExistingContest } from './contest-modal/types';
import { hasEffectivePermission, ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { buildRoute } from '@/lib/navigation/routes';
import { apiClient } from '@/lib/apiClient';
import type { ListSortInput } from '@/lib/list-sorting';

interface ContestListProps {
  initialContests: ContestRowData[];
  totalPages: number;
  permissionKeys: readonly string[];
  initialSort?: ListSortInput;
}

interface ContestPermissions {
  canCreate: boolean;
  canDelete: boolean;
  canDeploy: boolean;
  canUpdate: boolean;
}

function resolveContestPermissions(permissionKeys: readonly string[]): ContestPermissions {
  const effective = new Set(permissionKeys);
  return {
    canCreate: hasEffectivePermission(effective, ACTION_PERMISSIONS.createContest),
    canDelete: hasEffectivePermission(effective, ACTION_PERMISSIONS.deleteContest),
    canDeploy: hasEffectivePermission(effective, ACTION_PERMISSIONS.deployContest),
    canUpdate: hasEffectivePermission(effective, ACTION_PERMISSIONS.updateContest),
  };
}

export function ContestList({ initialContests, totalPages, permissionKeys, initialSort }: ContestListProps): React.JSX.Element {
  void totalPages;
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditWindowOpen, setIsEditWindowOpen] = useState(false);
  const [selectedContest, setSelectedContest] = useState<ExistingContest | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const actions = useContestListActions();
  const permissions = useMemo(() => resolveContestPermissions(permissionKeys), [permissionKeys]);
  const dict = useDictionary();

  const contestIds = useMemo(() => contests.map((contest) => contest.id), [contests]);
  const selection = useListSelection('contests.list', contestIds);

  const handleCreate = () => { if (!permissions.canCreate) return; setSelectedContest(null); setIsModalOpen(true); };
  const handleEdit = useCallback(async (id: number) => {
    if (!permissions.canUpdate) return;
    const result = await apiClient.get<{ contest: ExistingContest }>(`/api/contests/${id}`);
    const contest = result.contest as ExistingContest | undefined;
    if (result.success && contest) {
      setSelectedContest(contest);
      setIsModalOpen(true);
    } else {
      toast.error('Failed to load contest: ' + result.error);
    }
  }, [permissions.canUpdate]);
  const handleClose = () => { setIsModalOpen(false); setSelectedContest(null); };
  const handleSuccess = () => router.refresh();
  const handleOpenContest = useCallback((id: number) => {
    router.push(buildRoute(locale, 'contests.record', { id }));
  }, [router, locale]);

  // Why: one column definition drives desktop rows and mobile cards, so
  // the two layouts cannot drift apart.
  const columns = useMemo(
    () => [
      buildSelectionColumn<ContestRowData>({
        getRowId: (contest) => contest.id,
        selectedIds: selection.selectedIds,
        allSelected: selection.allSelected,
        partlyChecked: selection.someSelected,
        selectAllLabel: 'Select all contests',
        selectRowLabel: (contest) => `Select contest ${contest.id}`,
        onToggleAll: selection.toggleAll,
        onToggleOne: selection.toggleOne,
      }),
      ...buildContestColumns(handleOpenContest),
    ],
    [handleOpenContest, selection],
  );

  const renderRowActions = useCallback((contest: ContestRowData) => (
    <ContestRowActions contest={contest} permissionKeys={permissionKeys} onSetActive={actions.requestDeploy} onEdit={(id) => { void handleEdit(id); }} />
  ), [permissionKeys, actions.requestDeploy, handleEdit]);

  const applySort = (next: ListSortInput): void => {
    const params = new URLSearchParams(window.location.search);
    if (next !== null && next !== undefined) {
      params.set('sort', next.key);
      params.set('dir', next.direction);
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    const query = params.toString();
    router.replace(query.length > 0 ? `?${query}` : pathname);
  };

  return (
    <div className="space-y-6">
      <ContestListHeader locale={locale} canManage={permissions.canCreate} onCreate={handleCreate} />
      {permissions.canUpdate && (
        <BulkActionBar selectedCount={selection.selectedCount} onClear={selection.clear}>
          <Button variant="secondary" onClick={() => setIsEditWindowOpen(true)}>Edit window</Button>
          {/* Why both kinds, and why nothing starts applied: the checked rows seed this list's own
              kind and Q4 lets the operator add the other kind in the same picker, so this is the
              "edit limits" entry — the operator sets what to change before anything is written. */}
          <ApplyLimitsButton
            kinds={['contest', 'task']}
            preselected={{ contest: [...selection.selectedIds] }}
            initiallyTouched={false}
            patch={unsetLimitPatch()}
            label={dict.limits.apply.editButton}
            onSuccess={() => router.refresh()}
          />
        </BulkActionBar>
      )}
      <ResponsiveTable
        columns={columns}
        rows={contests}
        getRowKey={(contest) => contest.id}
        getRowClassName={getContestRowClassName}
        getRowProps={(contest) => getContestRowProps(contest, handleOpenContest)}
        renderRowActions={renderRowActions}
        sort={initialSort}
        onSortChange={applySort}
        emptyState={
          <EmptyState icon={Trophy} title="No contests found" description="Create your first contest to get started." />
        }
      />
      <ContestModal isOpen={isModalOpen} onClose={handleClose} contest={selectedContest} onSuccess={handleSuccess} permissionKeys={permissionKeys} />
      <DeployConfirmModal isOpen={actions.deployTarget !== null} phase={actions.deployState.phase} targetLabel={`#${actions.deployTarget}`} extraNote="The previous active contest will be deactivated." onClose={actions.closeDeploy} onConfirm={actions.confirmDeploy} />
      <ContestBulkEditDialog
        isOpen={isEditWindowOpen}
        onClose={() => setIsEditWindowOpen(false)}
        contestIds={[...selection.selectedIds]}
        onSuccess={() => { selection.clear(); router.refresh(); }}
      />
    </div>
  );
}
