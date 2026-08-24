'use client';

import { Edit2, HelpCircle, Plus, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { deleteTeam } from '@/app/actions/teams';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { useSyncedState } from '@/hooks/useSyncedState';
import { TeamModal } from './TeamModal';

interface TeamWithCount {
  id: number;
  code: string;
  name: string;
  organization?: string | null;
  leader?: { username: string; first_name: string; last_name: string } | null;
  _count?: { participations: number };
}

interface TeamListProps {
  initialTeams: TeamWithCount[];
  permissions: {
    permission_all: boolean;
    permission_tasks: boolean;
    permission_users: boolean;
    permission_contests: boolean;
    permission_messaging: boolean;
  };
}

export function TeamList({ initialTeams, permissions }: TeamListProps) {
  const [teams] = useSyncedState(initialTeams);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamWithCount | null>(null);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';

  const isSuperAdmin = permissions?.permission_all ?? false;
  const canManageUsers = isSuperAdmin || (permissions?.permission_users ?? false);

  const handleDelete = async (id: number) => {
    if (!canManageUsers) return;
    if (confirm('Delete this team?')) {
      const result = await deleteTeam(id);
      if (result.success) {
        window.location.reload();
      } else {
        alert(result.error);
      }
    }
  };

  const startEdit = (team: TeamWithCount) => {
    if (!canManageUsers) return;
    setEditingTeam(team);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">All Teams</h2>
          <Link href={`/${locale}/docs#users`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        {canManageUsers && (
          <Button
            variant="positive"
            icon={Plus}
            onClick={() => setIsModalOpen(true)}
          >
            Add Team
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Leader</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {teams.map((team) => (
            <TableRow key={team.id} data-shortcut-row={team.id} className="cursor-pointer">
              <TableCell className="font-mono text-muted-foreground text-xs">#{team.id}</TableCell>
              <TableCell className="font-mono text-primary text-sm">{team.code}</TableCell>
              <TableCell className="font-medium">{team.name}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{team._count?.participations ?? 0}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{team.organization ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {team.leader ? `${team.leader.first_name} ${team.leader.last_name}`.trim() || team.leader.username : '—'}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <a href={`/${locale}/teams/${team.id}`}>
                    <Button variant="ghost" size="sm" icon={Users} iconOnly tooltip="View team members" data-shortcut-primary />
                  </a>
                  {canManageUsers && (
                    <>
                      <Button variant="ghost" size="sm" icon={Edit2} iconOnly tooltip="Edit team" onClick={() => startEdit(team)} />
                      <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => handleDelete(team.id)} />
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {teams.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="p-0">
                <EmptyState
                  icon={Users}
                  title="No teams found"
                  description="Teams will appear here once created."
                  actionLabel={canManageUsers ? 'Add Team' : undefined}
                  onAction={canManageUsers ? () => setIsModalOpen(true) : undefined}
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <TeamModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingTeam(null); }}
        onSuccess={() => window.location.reload()}
        initialData={editingTeam}
      />
    </div>
  );
}
