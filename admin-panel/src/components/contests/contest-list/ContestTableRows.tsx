'use client';

import { useRouter } from 'next/navigation';
import { TableCell, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Badge } from '@/components/core/Badge';
import { Calendar, Clock, ExternalLink, Trash2, Rocket, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/apiClient';

function formatDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type StatusVariant = 'warning' | 'neutral' | 'success';

function getStatus(start: Date, stop: Date): { label: string; variant: StatusVariant } {
  const now = new Date();
  if (now < new Date(start)) return { label: 'Upcoming', variant: 'warning' };
  if (now > new Date(stop)) return { label: 'Ended', variant: 'neutral' };
  return { label: 'Active', variant: 'success' };
}

interface RowProps {
  contest: { id: number; name: string; is_active: boolean; start: Date; stop: Date; _count?: { tasks: number; participations: number } };
  locale: string;
  isSuperAdmin: boolean;
  canManage: boolean;
  onSetActive: (id: number) => void;
}

export function ContestTableRow({ contest, locale, isSuperAdmin, canManage, onSetActive }: RowProps) {
  const router = useRouter();
  const status = getStatus(contest.start, contest.stop);
  const isActive = contest.is_active === true;

  const handleDelete = async (id: number) => {
    if (!canManage) return;
    if (confirm('Are you sure you want to delete this contest? This is IRREVERSIBLE.')) {
      const result = await apiClient.delete(`/api/contests/${id}`);
      if (result.success) window.location.reload();
      else alert('Failed to delete contest: ' + result.error);
    }
  };

  return (
    <TableRow key={contest.id} className={cn(isActive && 'bg-primary/5')}>
      <TableCell className="font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>#{contest.id}</span>
          {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
        </div>
      </TableCell>
      <TableCell className="max-w-[200px] font-medium">
        <button
          onClick={() => router.push(`/${locale}/contests/${contest.id}`)}
          className="flex items-center gap-2 truncate text-foreground transition-colors hover:text-primary"
          title={contest.name}
        >
          {contest.name}
          <ExternalLink className="h-3 w-3 opacity-50" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {isActive && <Badge>Deployed</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Calendar className="h-3 w-3" /><span>{formatDate(contest.start)}</span></div>
          <div className="flex items-center gap-2"><Clock className="h-3 w-3" /><span>{formatDate(contest.stop)}</span></div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{contest._count?.tasks ?? 0}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{contest._count?.participations ?? 0}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {isSuperAdmin && !isActive && (
            <Button variant="ghost" size="sm" icon={Rocket} onClick={() => onSetActive(contest.id)}>Set Active</Button>
          )}
          {canManage && (
            <Button variant="ghost" size="sm" icon={Trash2} tooltip="Delete" onClick={() => handleDelete(contest.id)} />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
