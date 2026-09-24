'use client';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import type { ResponsiveColumn, ResponsiveRowProps } from '@/components/core/ResponsiveTable';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { Calendar, CheckCircle2, Clock, ExternalLink, Pencil, Power, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

export interface ContestRowData {
  id: number;
  name: string;
  is_active: boolean;
  start: Date;
  stop: Date;
  _count?: { tasks: number; participations: number };
}

type StatusVariant = 'warning' | 'neutral' | 'success';

function formatContestDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getContestStatus(start: Date, stop: Date): { label: string; variant: StatusVariant } {
  const now = new Date();
  if (now < new Date(start)) return { label: 'Upcoming', variant: 'warning' };
  if (now > new Date(stop)) return { label: 'Ended', variant: 'neutral' };
  return { label: 'Active', variant: 'success' };
}

function renderIdCell(contest: ContestRowData): React.JSX.Element {
  const isActive = contest.is_active === true;
  return (
    <span className="flex items-center gap-2 font-mono text-xs">
      <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>#{contest.id}</span>
      {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
    </span>
  );
}

function renderNameCell(contest: ContestRowData, onOpenContest: (id: number) => void): React.JSX.Element {
  return (
    <button
      onClick={() => onOpenContest(contest.id)}
      className="flex max-w-48 items-center gap-2 truncate font-medium text-foreground transition-colors hover:text-primary"
      title={contest.name}
    >
      {contest.name}
      <ExternalLink className="h-3 w-3 opacity-50" />
    </button>
  );
}

function renderStatusCell(contest: ContestRowData): React.JSX.Element {
  const status = getContestStatus(contest.start, contest.stop);
  const isActive = contest.is_active === true;
  return (
    <span className="flex items-center gap-2">
      <Badge variant={status.variant}>{status.label}</Badge>
      {isActive && <Badge>Deployed</Badge>}
    </span>
  );
}

function renderTimelineCell(contest: ContestRowData): React.JSX.Element {
  return (
    <span className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-2"><Calendar className="h-3 w-3" /><span>{formatContestDate(contest.start)}</span></span>
      <span className="flex items-center gap-2"><Clock className="h-3 w-3" /><span>{formatContestDate(contest.stop)}</span></span>
    </span>
  );
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
export function buildContestColumns(onOpenContest: (id: number) => void): ResponsiveColumn<ContestRowData>[] {
  return [
    { key: 'id', header: 'ID', render: renderIdCell },
    { key: 'name', header: 'Name', render: (contest) => renderNameCell(contest, onOpenContest) },
    { key: 'status', header: 'Status', render: renderStatusCell },
    { key: 'timeline', header: 'Timeline', render: renderTimelineCell },
    { key: 'tasks', header: 'Tasks', render: (contest) => <span className="text-xs text-muted-foreground">{contest._count?.tasks ?? 0}</span> },
    { key: 'participants', header: 'Participants', render: (contest) => <span className="text-xs text-muted-foreground">{contest._count?.participations ?? 0}</span> },
  ];
}

export function getContestRowClassName(contest: ContestRowData): string | undefined {
  return contest.is_active === true ? 'bg-primary/5' : undefined;
}

// Why: j/k navigation queries [data-shortcut-row]; without this prop
// the migrated contest list is invisible to the shortcut handler.
export function getContestRowProps(contest: ContestRowData): ResponsiveRowProps {
  return { 'data-shortcut-row': contest.id };
}

interface ContestRowActionsProps {
  contest: ContestRowData;
  canDeploy: boolean;
  canManage: boolean;
  canUpdate: boolean;
  onSetActive: (id: number) => void;
  onEdit: (id: number) => void;
}

// Why: shared by desktop rows and mobile cards, with 44px targets kept
// in this fragment so both layouts stay touch-sized.
export function ContestRowActions({ contest, canDeploy, canManage, canUpdate, onSetActive, onEdit }: ContestRowActionsProps): React.JSX.Element {
  const router = useAppRouter();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();

  const handleDelete = async (): Promise<void> => {
    if (!canManage) return;
    if (!(await confirm(destructiveConfirm('contest')))) return;
    const result = await runAction(
      { pending: 'Deleting contest...', success: 'Contest deleted', failure: 'Failed to delete contest' },
      () => apiClient.delete(`/api/contests/${contest.id}`)
    );
    if (result?.success) router.refresh();
  };
  return (
    <>
      {canUpdate && (
        <Button variant="ghost" size="sm" icon={Pencil} tooltip="Edit" aria-label={`Edit ${contest.name}`} onClick={() => onEdit(contest.id)} className="min-h-11 min-w-11" />
      )}
      {canDeploy && contest.is_active !== true && (
        <Button variant="ghost" size="sm" icon={Power} iconOnly tooltip="Set Active" onClick={() => onSetActive(contest.id)} className="min-h-11 min-w-11" />
      )}
      {canManage && (
        <Button variant="ghost" size="sm" icon={Trash2} tooltip="Delete" onClick={() => { void handleDelete(); }} className="min-h-11 min-w-11" />
      )}
    </>
  );
}
