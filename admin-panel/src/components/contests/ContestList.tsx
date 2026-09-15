'use client';

import { useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { Badge } from '@/components/core/Badge';
import { ExternalLink, Rocket, Trash2, Trophy } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/apiClient';
import { ContestModal } from './ContestModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { ContestListHeader } from './contest-list/ContestListHeader';
import { ContestTableRow } from './contest-list/ContestTableRows';
import { useContestListActions } from './contest-list/useContestListActions';
import type { ExistingContest } from './contest-modal/types';

interface ContestListProps {
  initialContests: Array<{ id: number; name: string; is_active: boolean; start: Date; stop: Date; _count?: { tasks: number; participations: number } }>;
  totalPages: number;
  permissions: { permission_all: boolean; permission_tasks: boolean; permission_users: boolean; permission_contests: boolean; permission_messaging: boolean };
}

type ContestItem = ContestListProps['initialContests'][number];

function formatContestDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getContestStatusLabel(start: Date, stop: Date): string {
  const now = new Date();
  if (now < new Date(start)) return 'Upcoming';
  if (now > new Date(stop)) return 'Ended';
  return 'Active';
}

interface CardProps {
  contest: ContestItem;
  locale: string;
  isSuperAdmin: boolean;
  canManage: boolean;
  onSetActive: (id: number) => void;
}

function ContestMobileCard({ contest, locale, isSuperAdmin, canManage, onSetActive }: CardProps) {
  const handleDelete = async () => {
    if (!canManage) return;
    if (confirm('Are you sure you want to delete this contest? This is IRREVERSIBLE.')) {
      const result = await apiClient.delete(`/api/contests/${contest.id}`);
      if (result.success) window.location.reload();
      else alert('Failed to delete contest: ' + result.error);
    }
  };
  return (
    <MobileCard>
      <MobileCardRow label="ID" value={`#${contest.id}`} />
      <MobileCardRow label="Name" value={contest.name} />
      <MobileCardRow label="Status" value={getContestStatusLabel(contest.start, contest.stop)} />
      {contest.is_active && <MobileCardRow label="Deployed" value={<Badge>Deployed</Badge>} />}
      <MobileCardRow label="Start" value={formatContestDate(contest.start)} />
      <MobileCardRow label="End" value={formatContestDate(contest.stop)} />
      <MobileCardRow label="Tasks" value={contest._count?.tasks ?? 0} />
      <MobileCardRow label="Participants" value={contest._count?.participations ?? 0} />
      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href={`/${locale}/contests/${contest.id}`} aria-label={`View ${contest.name}`} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
          <ExternalLink className="h-4 w-4" />
        </Link>
        {isSuperAdmin && !contest.is_active && (
          <button onClick={() => onSetActive(contest.id)} aria-label={`Set contest ${contest.id} active`} title="Set Active" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
            <Rocket className="h-4 w-4" />
          </button>
        )}
        {canManage && (
          <button onClick={handleDelete} aria-label={`Delete ${contest.name}`} title="Delete" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </MobileCard>
  );
}

export function ContestList({ initialContests, totalPages, permissions }: ContestListProps) {
  void totalPages;
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedContest] = useState<ExistingContest | null>(null);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const actions = useContestListActions();
  const isSuperAdmin = permissions?.permission_all ?? false;
  const canManage = isSuperAdmin || (permissions?.permission_contests ?? false);

  const handleCreate = () => { if (!canManage) return; setIsModalOpen(true); };
  const handleSuccess = () => window.location.reload();

  return (
    <div className="space-y-6">
      <ContestListHeader locale={locale} canManage={canManage} onCreate={handleCreate} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table
          mobileCards={contests.map((contest) => (
            <ContestMobileCard key={contest.id} contest={contest} locale={locale} isSuperAdmin={isSuperAdmin} canManage={canManage} onSetActive={actions.requestDeploy} />
          ))}
        >
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
              <ContestTableRow key={contest.id} contest={contest} locale={locale} isSuperAdmin={isSuperAdmin} canManage={canManage} onSetActive={actions.requestDeploy} />
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
      <ContestModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} contest={selectedContest} onSuccess={handleSuccess} />
      <DeployConfirmModal isOpen={actions.deployTarget !== null} phase={actions.deployState.phase} targetLabel={`#${actions.deployTarget}`} extraNote="The previous active contest will be deactivated." onClose={actions.closeDeploy} onConfirm={actions.confirmDeploy} />
    </div>
  );
}
