'use client';

import { useRouter } from 'next/navigation';
import { TableCell, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Calendar, Clock, ExternalLink, Trash2, Rocket, CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

function formatDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatus(start: Date, stop: Date): { label: string; color: string } {
  const now = new Date();
  if (now < new Date(start)) return { label: 'Upcoming', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  if (now > new Date(stop)) return { label: 'Ended', color: 'text-neutral-400 bg-neutral-500/10 border-neutral-500/20' };
  return { label: 'Active', color: 'text-green-400 bg-green-500/10 border-green-500/20' };
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
    <TableRow key={contest.id} className={`border-b border-white/5 transition-colors ${isActive ? 'bg-indigo-500/5 hover:bg-indigo-500/10' : 'hover:bg-white/5'}`}>
      <TableCell className="font-mono text-xs"><div className="flex items-center gap-2"><span className={isActive ? 'text-indigo-400' : 'text-neutral-500'}>#{contest.id}</span>{isActive && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}</div></TableCell>
      <TableCell className="font-medium max-w-[200px]"><button onClick={() => router.push(`/${locale}/contests/${contest.id}`)} className="flex items-center gap-2 text-white hover:text-indigo-400 transition-colors truncate" title={contest.name}>{contest.name}<ExternalLink className="w-3 h-3 opacity-50" /></button></TableCell>
      <TableCell><div className="flex items-center gap-2"><span className={`px-2 py-1 rounded-full text-xs font-medium border ${status.color}`}>{status.label}</span>{isActive && <span className="px-2 py-1 rounded-full text-xs font-medium border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">Deployed</span>}</div></TableCell>
      <TableCell><div className="flex flex-col gap-1 text-xs text-neutral-400"><div className="flex items-center gap-2"><Calendar className="w-3 h-3" /><span>{formatDate(contest.start)}</span></div><div className="flex items-center gap-2"><Clock className="w-3 h-3" /><span>{formatDate(contest.stop)}</span></div></div></TableCell>
      <TableCell className="text-xs text-neutral-400">{contest._count?.tasks ?? 0}</TableCell>
      <TableCell className="text-xs text-neutral-400">{contest._count?.participations ?? 0}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {isSuperAdmin && !isActive && <Button variant="ghost" size="sm" onClick={() => onSetActive(contest.id)} className="h-8 text-xs text-neutral-400 hover:text-indigo-400 gap-1"><Rocket className="w-3 h-3" />Set Active</Button>}
          {canManage && <Button variant="ghost" size="sm" onClick={() => handleDelete(contest.id)} className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></Button>}
        </div>
      </TableCell>
    </TableRow>
  );
}
