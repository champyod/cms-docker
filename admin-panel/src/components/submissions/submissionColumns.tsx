import { Clock, FileCode, User as UserIcon } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { SubmissionListItem } from '@/types';

type SubmissionResult = SubmissionListItem['submission_results'][number];

export function formatSubmissionDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Why the first result only: a submission is scored per dataset, and the list
// has always summarised the first one; the record tabs show every dataset.
function firstResult(submission: SubmissionListItem): SubmissionResult | undefined {
  return submission.submission_results[0];
}

export function submissionStatus(submission: SubmissionListItem): React.JSX.Element {
  const result = firstResult(submission);
  const score = result?.score;
  if (result?.compilation_outcome === 'fail') return <Badge variant="destructive">Compilation Failed</Badge>;
  if (result?.compilation_outcome === null) return <Badge variant="info" className="animate-pulse">Compiling</Badge>;
  if (result?.compilation_outcome !== undefined && result.evaluation_outcome === null) {
    return <Badge variant="indigo" className="animate-pulse">Evaluating</Badge>;
  }
  if (score === null || score === undefined) return <Badge variant="neutral">Pending</Badge>;
  return (
    <Badge variant={score > 0 ? 'success' : 'destructive'} className="font-mono">
      {score.toFixed(0)} / 100
    </Badge>
  );
}

function submissionUser(submission: SubmissionListItem): React.JSX.Element {
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-2 font-medium">
        <UserIcon className="w-3 h-3 text-muted-foreground" />
        {submission.participations.users.username}
      </span>
      <span className="text-xs text-muted-foreground ml-5">{submission.participations.contests.name}</span>
    </span>
  );
}

function submissionScore(submission: SubmissionListItem): React.JSX.Element {
  const score = firstResult(submission)?.score;
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className={score > 0 ? 'text-success' : 'text-destructive'}>{score.toFixed(0)}</span>;
}

// Why one definition: the same columns drive the desktop table and the mobile
// cards, so a cell can no longer be edited in one layout and forgotten in the
// other.
export function buildSubmissionColumns(): ResponsiveColumn<SubmissionListItem>[] {
  return [
    { key: 'id', header: 'ID', headerClassName: 'w-24', cellClassName: 'font-mono text-muted-foreground text-xs', render: (row) => <span>#{row.id}</span> },
    { key: 'time', header: 'Time', render: (row) => (
      <span className="flex items-center gap-2 text-sm">
        <Clock className="w-3 h-3 text-muted-foreground" />
        {formatSubmissionDate(row.timestamp)}
      </span>
    ) },
    { key: 'user', header: 'User', render: (row) => submissionUser(row) },
    { key: 'task', header: 'Task', render: (row) => (
      <span className="flex items-center gap-2">
        <FileCode className="w-3 h-3 text-muted-foreground" />
        {row.tasks.name}
      </span>
    ) },
    { key: 'language', header: 'Language', cellClassName: 'font-mono text-sm', render: (row) => <span>{row.language ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (row) => submissionStatus(row) },
    { key: 'score', header: 'Score', headerClassName: 'text-right', cellClassName: 'text-right font-mono text-sm', render: (row) => submissionScore(row) },
  ];
}
