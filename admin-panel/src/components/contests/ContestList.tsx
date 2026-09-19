'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { Badge } from '@/components/core/Badge';
import { ExternalLink, Pencil, Rocket, Trash2, Trophy } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/apiClient';
import { ContestModal } from './ContestModal';
import { DeployConfirmModal } from './DeployConfirmModal';
import { ContestListHeader } from './contest-list/ContestListHeader';
import { ContestTableRow } from './contest-list/ContestTableRows';
import { useContestListActions } from './contest-list/useContestListActions';
import type { ExistingContest } from './contest-modal/types';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';

interface ContestListProps {
  initialContests: Array<{ id: number; name: string; is_active: boolean; start: Date; stop: Date; _count?: { tasks: number; participations: number } }>;
  totalPages: number;
  permissionKeys: readonly string[];
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
  canUpdate: boolean;
  onSetActive: (id: number) => void;
  onEdit: (id: number) => void;
}

function ContestMobileCard({ contest, locale, isSuperAdmin, canManage, canUpdate, onSetActive, onEdit }: CardProps): React.JSX.Element {
  const router = useRouter();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const handleDelete = async (): Promise<void> => {
    if (!canManage) return;
    if (!(await confirm(destructiveConfirm('contest')))) return;
    const result = await apiClient.delete(`/api/contests/${contest.id}`);
    if (result.success) {
      toast.success('Contest deleted');
      router.refresh();
    } else toast.error('Failed to delete contest: ' + result.error);
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
        {canUpdate && (
          <button onClick={() => onEdit(contest.id)} aria-label={`Edit ${contest.name}`} title="Edit" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {isSuperAdmin && !contest.is_active && (
          <button onClick={() => onSetActive(contest.id)} aria-label={`Set contest ${contest.id} active`} title="Set Active" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
            <Rocket className="h-4 w-4" />
          </button>
        )}
        {canManage && (
          <button onClick={() => { void handleDelete(); }} aria-label={`Delete ${contest.name}`} title="Delete" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </MobileCard>
  );
}

export function ContestList({ initialContests, totalPages, permissionKeys }: ContestListProps): React.JSX.Element {
  void totalPages;
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedContest, setSelectedContest] = useState<ExistingContest | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname.split('/')[1] || 'en';
  const actions = useContestListActions();
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateContests = hasEffectivePermission(effective, 'contest:create');
  const canDeleteContests = hasEffectivePermission(effective, 'contest:delete');
  const canSwitchContests = hasEffectivePermission(effective, 'contest:switch');
  const canUpdateContests = hasEffectivePermission(effective, 'contest:update');

  const handleCreate = () => { if (!canCreateContests) return; setSelectedContest(null); setIsModalOpen(true); };
  const handleEdit = async (id: number) => {
    if (!canUpdateContests) return;
    const result = await apiClient.get<{ contest: ExistingContest }>(`/api/contests/${id}`);
    const contest = result.contest as ExistingContest | undefined;
    if (result.success && contest) {
      setSelectedContest(contest);
      setIsModalOpen(true);
    } else {
      toast.error('Failed to load contest: ' + result.error);
    }
  };
  const handleClose = () => { setIsModalOpen(false); setSelectedContest(null); };
  const handleSuccess = () => router.refresh();

  return (
    <div className="space-y-6">
      <ContestListHeader locale={locale} canManage={canCreateContests} onCreate={handleCreate} />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table
          className="table-fixed"
          mobileCards={contests.map((contest) => (
            <ContestMobileCard key={contest.id} contest={contest} locale={locale} isSuperAdmin={canSwitchContests} canManage={canDeleteContests} canUpdate={canUpdateContests} onSetActive={actions.requestDeploy} onEdit={handleEdit} />
          ))}
        >
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-60">Timeline</TableHead>
              <TableHead className="w-20">Tasks</TableHead>
              <TableHead className="w-28">Participants</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => (
              <ContestTableRow key={contest.id} contest={contest} locale={locale} isSuperAdmin={canSwitchContests} canManage={canDeleteContests} canUpdate={canUpdateContests} onSetActive={actions.requestDeploy} onEdit={handleEdit} />
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
      <ContestModal isOpen={isModalOpen} onClose={handleClose} contest={selectedContest} onSuccess={handleSuccess} permissionKeys={permissionKeys} />
      <DeployConfirmModal isOpen={actions.deployTarget !== null} phase={actions.deployState.phase} targetLabel={`#${actions.deployTarget}`} extraNote="The previous active contest will be deactivated." onClose={actions.closeDeploy} onConfirm={actions.confirmDeploy} />
    </div>
  );
}
