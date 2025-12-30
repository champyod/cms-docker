'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Eye, Clock, User as UserIcon, FileCode, Trophy, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { SubmissionModal } from './SubmissionModal';
import { useRouter } from 'next/navigation';

import { SubmissionWithRelations } from '@/types';

export function SubmissionList({ initialSubmissions, totalPages, currentPage }: { initialSubmissions: SubmissionWithRelations[], totalPages: number, currentPage: number }) {
  const [submissions] = useState(initialSubmissions);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionWithRelations | null>(null);
  const router = useRouter();

  const handleView = (submission: SubmissionWithRelations) => {
    setSelectedSubmission(submission);
  };

  const formatDate = (date: Date) => {
     return new Date(date).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
     });
  };
  
  const handlePageChange = (newPage: number) => {
      const url = new URL(window.location.href);
      url.searchParams.set('page', newPage.toString());
      router.push(url.toString());
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">All Submissions</h2>
          <Link href="/en/docs#submissions" className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        <div className="text-sm text-neutral-400">
            Page {currentPage} of {totalPages}
        </div>
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400 w-[100px]">ID</TableHead>
              <TableHead className="text-neutral-400">Time</TableHead>
              <TableHead className="text-neutral-400">User</TableHead>
              <TableHead className="text-neutral-400">Task</TableHead>
              <TableHead className="text-neutral-400">Status</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((submission) => {
              const result = submission.submission_results[0]; // Assuming first result is the one we care about for list
              const score = result?.score;
              const compiling = result?.compilation_outcome === null;
              const evaluating = result?.evaluation_outcome === null;

              return (
                <TableRow 
                    key={submission.id} 
                    className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group"
                    onClick={() => handleView(submission)}
                >
                    <TableCell className="font-mono text-neutral-500 text-xs">#{submission.id}</TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2 text-neutral-300 text-sm">
                            <Clock className="w-3 h-3 text-neutral-500" />
                            {formatDate(submission.timestamp)}
                        </div>
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2 text-white font-medium">
                            <UserIcon className="w-3 h-3 text-neutral-500" />
                            {submission.participations.users.username}
                        </div>
                        <div className="text-[10px] text-neutral-500 ml-5">{submission.participations.contests.name}</div>
                    </TableCell>
                    <TableCell>
                         <div className="flex items-center gap-2 text-neutral-300">
                            <FileCode className="w-3 h-3 text-neutral-500" />
                            {submission.tasks.name}
                        </div>
                    </TableCell>
                    <TableCell>
                        {compiling ? (
                             <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">Compiling</span>
                        ) : evaluating ? (
                             <span className="text-xs px-2 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 animate-pulse">Evaluating</span>
                        ) : score !== null && score !== undefined ? (
                            <span className={`text-xs px-2 py-1 rounded-full border font-mono font-bold ${
                                score > 0 ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'
                            }`}>
                                {score.toFixed(0)} / 100
                            </span>
                        ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">Pending</span>
                        )}
                    </TableCell>
                    <TableCell className="text-right">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Eye className="w-4 h-4" />
                        </Button>
                    </TableCell>
                </TableRow>
              );
            })}
            {submissions.length === 0 && (
                <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-neutral-500">
                        No submissions found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Pagination Controls */}
      <div className="flex justify-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
              Previous
          </Button>
          <div className="flex items-center px-4 text-sm text-neutral-400">
              Page {currentPage}
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            disabled={currentPage >= totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
              Next
          </Button>
      </div>

      {selectedSubmission && (
        <SubmissionModal 
            isOpen={!!selectedSubmission} 
            onClose={() => setSelectedSubmission(null)} 
            submission={selectedSubmission}
        />
      )}
    </div>
  );
}
