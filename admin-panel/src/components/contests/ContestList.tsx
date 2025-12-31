'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import Link from 'next/link';
import { Trash2, Plus, Calendar, Clock, ExternalLink, HelpCircle } from 'lucide-react';
import { ContestModal } from './ContestModal';
import { apiClient } from '@/lib/apiClient';
import { contests } from '@prisma/client';

export function ContestList({ initialContests, totalPages }: { initialContests: contests[], totalPages: number }) {
  const router = useRouter();
  const [contests] = useState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedContest, setSelectedContest] = useState<contests | null>(null);



  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this contest? This is IRREVERSIBLE.')) {
      const result = await apiClient.delete(`/api/contests/${id}`);
      if (result.success) {
         window.location.reload(); 
      } else {
        alert('Failed to delete contest: ' + result.error);
      }
    }
  };

  const handleCreate = () => {
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
          <Link href="/en/docs#contests" className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        <Button 
            variant="primary" 
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
            onClick={handleCreate}
        >
          <Plus className="w-4 h-4" />
          Create Contest
        </Button>
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Status</TableHead>
              <TableHead className="text-neutral-400">Timeline</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => {
              const status = getStatus(contest.start, contest.stop);
              return (
                <TableRow key={contest.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <TableCell className="font-mono text-neutral-500 text-xs">#{contest.id}</TableCell>
                  <TableCell className="font-medium text-white max-w-[200px]">
                    <button
                      onClick={() => router.push(`/en/contests/${contest.id}`)}
                      className="flex items-center gap-2 hover:text-indigo-400 transition-colors truncate"
                      title={contest.name}
                    >
                      {contest.name}
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                    </TableCell>
                    <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${status.color}`}>
                            {status.label}
                        </span>
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
                    <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                        <Button 
                            variant="ghost" 
                        size="sm" 
                            onClick={() => handleDelete(contest.id)}
                            className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400"
                        >
                        <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                    </TableCell>
                </TableRow>
              );
            })}
            {contests.length === 0 && (
                <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-neutral-500">
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
    </div>
  );
}
