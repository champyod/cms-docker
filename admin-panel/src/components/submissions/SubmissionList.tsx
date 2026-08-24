'use client';

import { Clock, Eye, FileCode, HelpCircle, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { useSyncedState } from '@/hooks/useSyncedState';

import { SubmissionListItem } from '@/types';

import { SubmissionModal } from './SubmissionModal';

export function SubmissionList({ initialSubmissions, totalPages, currentPage }: { initialSubmissions: SubmissionListItem[], totalPages: number, currentPage: number }) {
  const [submissions] = useSyncedState(initialSubmissions);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionListItem | null>(null);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useRouter();

  const handleView = (submission: SubmissionListItem) => {
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
          <h2 className="text-xl font-bold">All Submissions</h2>
          <Link href={`/${locale}/docs#submissions`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">ID</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((submission) => {
            const result = submission.submission_results[0]; // Assuming first result is the one we care about for list
            const score = result?.score;
            const compilationFailed = result?.compilation_outcome === 'fail';
            const compiling = result?.compilation_outcome === null;
            const evaluating = !compilationFailed && result?.evaluation_outcome === null;

            return (
              <TableRow
                key={submission.id}
                data-shortcut-row={submission.id}
                className="cursor-pointer"
                onClick={() => handleView(submission)}
              >
                  <TableCell className="font-mono text-muted-foreground text-xs">#{submission.id}</TableCell>
                  <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {formatDate(submission.timestamp)}
                      </div>
                  </TableCell>
                  <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                          <UserIcon className="w-3 h-3 text-muted-foreground" />
                          {submission.participations.users.username}
                      </div>
                      <div className="text-[10px] text-muted-foreground ml-5">{submission.participations.contests.name}</div>
                  </TableCell>
                  <TableCell>
                       <div className="flex items-center gap-2">
                          <FileCode className="w-3 h-3 text-muted-foreground" />
                          {submission.tasks.name}
                      </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                      {submission.language ?? '—'}
                  </TableCell>
                  <TableCell>
                    {compilationFailed ? (
                      <Badge variant="destructive">Compilation Failed</Badge>
                    ) : compiling ? (
                      <Badge variant="info" className="animate-pulse">Compiling</Badge>
                    ) : evaluating ? (
                      <Badge variant="indigo" className="animate-pulse">Evaluating</Badge>
                    ) : score !== null && score !== undefined ? (
                      <Badge variant={score > 0 ? 'success' : 'destructive'} className="font-mono">
                        {score.toFixed(0)} / 100
                      </Badge>
                    ) : (
                      <Badge variant="neutral">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                      {score !== null && score !== undefined ? (
                          <span className={score > 0 ? 'text-success' : 'text-destructive'}>{score.toFixed(0)}</span>
                      ) : (
                          <span className="text-muted-foreground">—</span>
                      )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Eye}
                        iconOnly
                        tooltip="View submission"
                        data-shortcut-primary
                        onClick={() => handleView(submission)}
                      />
                    </div>
                  </TableCell>
              </TableRow>
            );
          })}
          {submissions.length === 0 && (
              <TableRow>
                  <TableCell colSpan={8} className="p-0">
                      <EmptyState
                          icon={FileCode}
                          title="No submissions found"
                          description="Submissions will appear here once contestants start submitting."
                      />
                  </TableCell>
              </TableRow>
          )}
        </TableBody>
      </Table>

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
          <div className="flex items-center px-4 text-sm text-muted-foreground">
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
