'use client';

import { useState, useEffect } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trash2, Plus, Calendar, Clock, ExternalLink, HelpCircle, Rocket, CheckCircle2, Loader2 } from 'lucide-react';
import { ContestModal } from './ContestModal';
import { apiClient } from '@/lib/apiClient';
import { useDeployContest } from '@/hooks/useDeployContest';
import { useToast } from '@/components/providers/ToastProvider';
import { Modal } from '@/components/core/Modal';

interface ContestListProps {
  initialContests: any[];
  totalPages: number;
  permissions: {
    permission_all: boolean;
    permission_tasks: boolean;
    permission_users: boolean;
    permission_contests: boolean;
    permission_messaging: boolean;
  };
}

export function ContestList({ initialContests, totalPages, permissions }: ContestListProps) {
  const router = useRouter();
  const [contests] = useSyncedState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const [selectedContest, setSelectedContest] = useState<any | null>(null);
  const { addToast } = useToast();
  const { state: deployState, deploy: handleDeploy, reset: resetDeployState } = useDeployContest();
  const [deployTarget, setDeployTarget] = useState<number | null>(null);

  const isSuperAdmin = permissions?.permission_all ?? false;
  const canManageContests = isSuperAdmin || (permissions?.permission_contests ?? false);

  const handleDelete = async (id: number) => {
    if (!canManageContests) return;
    if (confirm('Are you sure you want to delete this contest? This is IRREVERSIBLE.')) {
      const result = await apiClient.delete(`/api/contests/${id}`);
      if (result.success) {
         window.location.reload(); 
      } else {
        alert('Failed to delete contest: ' + result.error);
      }
    }
  };

  const handleSetActive = (id: number) => {
    if (!isSuperAdmin) return;
    setDeployTarget(id);
  };

  const confirmDeploy = () => {
    if (deployTarget === null) return;
    handleDeploy(deployTarget);
  };

  const closeDeployModal = () => {
    setDeployTarget(null);
    resetDeployState();
  };

  useEffect(() => {
    if (deployState.phase === 'completed') {
      addToast({ type: 'success', title: 'Contest Deployed', message: `Contest #${deployState.contestId} is now active.` });
      setDeployTarget(null);
      resetDeployState();
      window.location.reload();
    } else if (deployState.phase === 'failed' || deployState.phase === 'timeout') {
      addToast({ type: 'error', title: 'Deploy Failed', message: deployState.error || 'Deploy did not complete.' });
      setDeployTarget(null);
      resetDeployState();
    } else if (deployState.phase === 'already_running') {
      addToast({ type: 'warning', title: 'Deploy Already Running', message: deployState.error || 'Another deploy is in progress.' });
      setDeployTarget(null);
      resetDeployState();
    }
  }, [deployState.phase]);

  const handleCreate = () => {
    if (!canManageContests) return;
    setSelectedContest(null);
    setIsModalOpen(true);
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  const formatDate = (date: Date) => {
     return new Date(date).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
     });
  };

  const getStatus = (start: Date, stop: Date) => {
      const now = new Date();
      if (now < new Date(start)) return { label: 'Upcoming', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      if (now > new Date(stop)) return { label: 'Ended', color: 'text-neutral-400 bg-neutral-500/10 border-neutral-500/20' };
      return { label: 'Active', color: 'text-green-400 bg-green-500/10 border-green-500/20' };
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">All Contests</h2>
          <Link href={`/${locale}/docs#contests`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        {canManageContests && (
          <Button 
              variant="primary" 
              className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
              onClick={handleCreate}
          >
            <Plus className="w-4 h-4" />
            Create Contest
          </Button>
        )}
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Status</TableHead>
              <TableHead className="text-neutral-400">Timeline</TableHead>
              <TableHead className="text-neutral-400">Tasks</TableHead>
              <TableHead className="text-neutral-400">Participants</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => {
              const status = getStatus(contest.start, contest.stop);
              const isActive = contest.is_active === true;
              return (
                <TableRow key={contest.id} className={`border-b border-white/5 transition-colors ${isActive ? 'bg-indigo-500/5 hover:bg-indigo-500/10' : 'hover:bg-white/5'}`}>
                    <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-2">
                            <span className={isActive ? 'text-indigo-400' : 'text-neutral-500'}>#{contest.id}</span>
                            {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
                        </div>
                    </TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <button
                      onClick={() => router.push(`/${locale}/contests/${contest.id}`)}
                      className="flex items-center gap-2 text-white hover:text-indigo-400 transition-colors truncate"
                      title={contest.name}
                    >
                      {contest.name}
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium border ${status.color}`}>
                                {status.label}
                            </span>
                            {isActive && (
                                <span className="px-2 py-1 rounded-full text-xs font-medium border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
                                    Deployed
                                </span>
                            )}
                        </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex flex-col gap-1 text-xs text-neutral-400">
                            <div className="flex items-center gap-2">
                                <Calendar className="w-3 h-3" />
                                <span>{formatDate(contest.start)}</span>
                            </div>
                             <div className="flex items-center gap-2">
                                 <Clock className="w-3 h-3" />
                                 <span>{formatDate(contest.stop)}</span>
                             </div>
                         </div>
                     </TableCell>
                     <TableCell className="text-xs text-neutral-400">
                         {contest._count?.tasks ?? 0}
                     </TableCell>
                     <TableCell className="text-xs text-neutral-400">
                         {contest._count?.participations ?? 0}
                     </TableCell>
                     <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                        {isSuperAdmin && !isActive && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSetActive(contest.id)}
                                className="h-8 text-xs text-neutral-400 hover:text-indigo-400 gap-1"
                            >
                                <Rocket className="w-3 h-3" />
                                Set Active
                            </Button>
                        )}
                        {canManageContests && (
                            <Button 
                                variant="ghost" 
                            size="sm" 
                                onClick={() => handleDelete(contest.id)}
                                className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400"
                            >
                            <Trash2 className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                    </TableCell>
                </TableRow>
              );
            })}
            {contests.length === 0 && (
                <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-neutral-500">
                        No contests found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
       
      <ContestModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        contest={selectedContest}
        onSuccess={handleSuccess}
      />

      <Modal
        isOpen={deployTarget !== null}
        onClose={closeDeployModal}
        title={deployState.phase === 'deploying' || deployState.phase === 'polling' ? 'Deploying Contest...' : 'Confirm Deploy'}
      >
        <div className="space-y-4">
          {deployTarget !== null && (deployState.phase === 'idle' || deployState.phase === 'already_running') && (
            <>
              <p className="text-neutral-300 text-sm">
                This will mark contest <strong className="text-white">#{deployTarget}</strong> as active,
                update the .env file, and restart the contest stack. The previous active contest will be deactivated.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={closeDeployModal}>Cancel</Button>
                <Button variant="primary" onClick={confirmDeploy} className="flex items-center gap-2">
                  <Rocket className="w-4 h-4" />
                  Deploy
                </Button>
              </div>
            </>
          )}
          {(deployState.phase === 'deploying' || deployState.phase === 'polling') && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              <p className="text-neutral-300 text-sm">
                {deployState.phase === 'deploying' ? 'Starting deploy...' : 'Deploying contest stack...'}
              </p>
            </div>
          )}
          {deployState.phase === 'completed' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
              <p className="text-green-300 text-sm font-medium">Contest deployed successfully!</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
