'use client';

import { Edit2, HelpCircle, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { deleteTeam } from '@/app/actions/teams';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { useConfirm } from '@/hooks/useConfirm';
import { useSyncedState } from '@/hooks/useSyncedState';
import { destructiveConfirm } from '@/lib/confirmation-copy';
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
  permissionKeys: readonly string[];
}

export function TeamList({ initialTeams, permissionKeys }: TeamListProps) {
  const [teams] = useSyncedState(initialTeams);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamWithCount | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const confirm = useConfirm();
  const locale = pathname.split('/')[1] || 'en';

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateTeams = hasEffectivePermission(effective, 'team:create');
  const canManageUsers = hasEffectivePermission(effective, 'team:update');
  const canDeleteTeams = hasEffectivePermission(effective, 'team:delete');

  const handleDelete = async (id: number) => {
    if (!canDeleteTeams) return;
    if (!(await confirm(destructiveConfirm('team')))) return;
    const result = await deleteTeam(id);
    if (result.success) {
      router.refresh();
    } else {
      toast.error(result.error);
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
        {canCreateTeams && (
          <Button
            variant="positive"
            icon={Plus}
            onClick={() => setIsModalOpen(true)}
          >
            Add Team
          </Button>
        )}
      </div>

      <Table
        mobileCards={teams.map((team) => (
          <MobileCard key={team.id}>
            <MobileCardRow label="Code" value={team.code} />
            <MobileCardRow label="Name" value={team.name} />
            <MobileCardRow label="Members" value={team._count?.participations ?? 0} />
            <MobileCardRow label="Leader" value={team.leader ? `${team.leader.first_name} ${team.leader.last_name}`.trim() || team.leader.username : '—'} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <a href={`/${locale}/teams/${team.id}`}>
                <Button variant="ghost" size="sm" icon={Users} iconOnly tooltip="View team members" />
              </a>
              {canManageUsers && (
                <>
                  <Button variant="ghost" size="sm" icon={Edit2} iconOnly tooltip="Edit team" onClick={() => startEdit(team)} />
                  <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void handleDelete(team.id); }} />
                </>
              )}
            </div>
          </MobileCard>
        ))}
      >
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
                    <Button variant="ghost" size="sm" icon={Edit2} iconOnly tooltip="Edit team" onClick={() => startEdit(team)} />
                  )}
                  {canDeleteTeams && (
                    <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void handleDelete(team.id); }} />
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
                  actionLabel={canCreateTeams ? 'Add Team' : undefined}
                  onAction={canCreateTeams ? () => setIsModalOpen(true) : undefined}
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <TeamModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingTeam(null); }}
        onSuccess={() => router.refresh()}
        initialData={editingTeam}
        permissionKeys={permissionKeys}
      />
    </div>
  );
}
