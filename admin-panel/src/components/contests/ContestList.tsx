'use client';

import { useMemo, useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { EmptyState } from '@/components/core/EmptyState';
import { Trophy } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { ContestModal } from './ContestModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { ContestListHeader } from './contest-list/ContestListHeader';
import { ContestTableRow } from './contest-list/ContestTableRows';
import { useContestListActions } from './contest-list/useContestListActions';
import type { ExistingContest } from './contest-modal/types';
import { hasEffectivePermission } from '@/lib/permission-engine';

interface ContestListProps {
  initialContests: Array<{ id: number; name: string; is_active: boolean; start: Date; stop: Date; _count?: { tasks: number; participations: number } }>;
  totalPages: number;
  permissionKeys: readonly string[];
}

export function ContestList({ initialContests, totalPages, permissionKeys }: ContestListProps) {
  void totalPages;
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedContest] = useState<ExistingContest | null>(null);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const actions = useContestListActions();
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateContests = hasEffectivePermission(effective, 'contest:create');
  const canDeleteContests = hasEffectivePermission(effective, 'contest:delete');
  const canSwitchContests = hasEffectivePermission(effective, 'contest:switch');

  const handleCreate = () => { if (!canCreateContests) return; setIsModalOpen(true); };
  const handleSuccess = () => window.location.reload();

  return (
    <div className="space-y-6">
      <ContestListHeader locale={locale} canManage={canCreateContests} onCreate={handleCreate} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead>Participants</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => (
              <ContestTableRow key={contest.id} contest={contest} locale={locale} isSuperAdmin={canSwitchContests} canManage={canDeleteContests} onSetActive={actions.requestDeploy} />
            ))}
            {contests.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState icon={Trophy} title="No contests found" description="Create your first contest to get started." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <ContestModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} contest={selectedContest} onSuccess={handleSuccess} permissionKeys={permissionKeys} />
      <DeployConfirmModal isOpen={actions.deployTarget !== null} phase={actions.deployState.phase} targetLabel={`#${actions.deployTarget}`} extraNote="The previous active contest will be deactivated." onClose={actions.closeDeploy} onConfirm={actions.confirmDeploy} />
    </div>
  );
}
