'use client';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Calendar, CheckCircle2, Clock, ExternalLink, Rocket, Trash2 } from 'lucide-react';
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

async function deleteContest(id: number, canManage: boolean): Promise<void> {
  if (!canManage) return;
  if (!confirm('Are you sure you want to delete this contest? This is IRREVERSIBLE.')) return;
  const result = await apiClient.delete(`/api/contests/${id}`);
  if (result.success) window.location.reload();
  else alert('Failed to delete contest: ' + result.error);
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

interface ContestRowActionsProps {
  contest: ContestRowData;
  isSuperAdmin: boolean;
  canManage: boolean;
  onSetActive: (id: number) => void;
}

// Why: shared by desktop rows and mobile cards, with 44px targets kept
// in this fragment so both layouts stay touch-sized.
export function ContestRowActions({ contest, isSuperAdmin, canManage, onSetActive }: ContestRowActionsProps): React.JSX.Element {
  const handleDelete = async (): Promise<void> => {
    await deleteContest(contest.id, canManage);
  };
  return (
    <>
      {isSuperAdmin && contest.is_active !== true && (
        <Button variant="ghost" size="sm" icon={Rocket} onClick={() => onSetActive(contest.id)} className="min-h-11 min-w-11">Set Active</Button>
      )}
      {canManage && (
        <Button variant="ghost" size="sm" icon={Trash2} tooltip="Delete" onClick={handleDelete} className="min-h-11 min-w-11" />
      )}
    </>
  );
}
