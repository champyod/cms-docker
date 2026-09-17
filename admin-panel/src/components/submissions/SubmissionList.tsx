'use client';

import { Clock, Eye, FileCode, HelpCircle, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { useSyncedState } from '@/hooks/useSyncedState';

import { SubmissionListItem } from '@/types';

import { SubmissionModal } from './SubmissionModal';
import { selectSubmission } from './submissionSelection';

export function SubmissionList({ initialSubmissions, totalPages, currentPage }: { initialSubmissions: SubmissionListItem[], totalPages: number, currentPage: number }) {
  const [submissions] = useSyncedState(initialSubmissions);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  // WHY the id and not the row: recalculateSubmission refreshes the list, so rendering a
  // stored copy would keep the modal on the pre-recalculation results until it was closed
  // and reopened. Deriving from the current list keeps it open and up to date.
  const selectedSubmission = selectSubmission(submissions, selectedSubmissionId);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useRouter();

  const handleView = (submission: SubmissionListItem) => {
    setSelectedSubmissionId(submission.id);
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

      <Table
        mobileCards={submissions.map((submission) => {
          const result = submission.submission_results[0];
          const score = result?.score;
          const compilationFailed = result?.compilation_outcome === 'fail';
          const compiling = result?.compilation_outcome === null;
          const evaluating = !compilationFailed && result?.evaluation_outcome === null;
          return (
            <MobileCard key={submission.id}>
              <MobileCardRow label="ID" value={`#${submission.id}`} />
              <MobileCardRow label="Time" value={formatDate(submission.timestamp)} />
              <MobileCardRow label="User" value={submission.participations.users.username} />
              <MobileCardRow label="Task" value={submission.tasks.name} />
              <MobileCardRow label="Language" value={submission.language ?? '—'} />
              <MobileCardRow
                label="Status"
                value={
                  compilationFailed ? (
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
                  )
                }
              />
              <MobileCardRow
                label="Score"
                value={score !== null && score !== undefined ? score.toFixed(0) : '—'}
              />
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => handleView(submission)}
                  aria-label={`View submission ${submission.id}`}
                  title="View submission"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            </MobileCard>
          );
        })}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">ID</TableHead>
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
            const result = submission.submission_results[0];
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
                      <div className="text-xs text-muted-foreground ml-5">{submission.participations.contests.name}</div>
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
            onClose={() => setSelectedSubmissionId(null)}
            submission={selectedSubmission}
        />
      )}
    </div>
  );
}
