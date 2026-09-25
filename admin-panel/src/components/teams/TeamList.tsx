'use client';

import { Pencil, HelpCircle, Plus, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useMemo, useState } from 'react';

import { deleteTeam } from '@/app/actions/teams';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { TeamSummary } from '@/lib/people-read-model-types';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useSyncedState } from '@/hooks/useSyncedState';
import { TeamModal } from './TeamModal';

export interface TeamListProps {
  readonly initialTeams: readonly TeamSummary[];
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
}

function leaderName(team: TeamSummary): string {
  if (!team.leader) return '—';
  return `${team.leader.firstName} ${team.leader.lastName}`.trim() || team.leader.username;
}

export function TeamList({ initialTeams, permissionKeys, navigation }: TeamListProps) {
  const [teams] = useSyncedState(initialTeams);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamSummary | null>(null);
  const pathname = usePathname();
  const router = useAppRouter();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const locale = pathname.split('/')[1] || 'en';

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canCreateTeams = hasEffectivePermission(effective, 'team:create');
  const canManageTeams = hasEffectivePermission(effective, 'team:update');
  const canDeleteTeams = hasEffectivePermission(effective, 'team:delete');

  const runAction = useActionFeedback();

  const handleDelete = async (id: number) => {
    if (!canDeleteTeams) return;
    if (!(await confirm(destructiveConfirm('team')))) return;
    const result = await runAction(
      { pending: 'Deleting team...', success: 'Team deleted', failure: 'Delete failed' },
      () => deleteTeam(id)
    );
    if (result?.success) router.refresh();
  };

  const startEdit = (team: TeamSummary) => {
    if (!canManageTeams) return;
    setEditingTeam(team);
    setIsModalOpen(true);
  };

  const recordHref = (team: TeamSummary) => buildRoute(locale, 'people.team-record', { id: team.id });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href={`/${locale}/docs#users`}
          className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary"
          title="View Documentation"
        >
          <HelpCircle className="w-4 h-4" />
        </Link>
        {canCreateTeams && (
          <Button variant="positive" icon={Plus} onClick={() => setIsModalOpen(true)}>
            Add Team
          </Button>
        )}
      </div>

      <Table
        mobileCards={teams.map((team) => (
          <MobileCard key={team.id}>
            <MobileCardRow label="Code" value={team.code} />
            <MobileCardRow label="Name" value={team.name} />
            <MobileCardRow label="Members" value={team.participationCount} />
            <MobileCardRow label="Leader" value={leaderName(team)} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <a href={recordHref(team)}>
                <Button variant="ghost" size="sm" icon={Users} iconOnly tooltip="View team members" />
              </a>
              {canManageTeams && (
                <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit team" onClick={() => startEdit(team)} />
              )}
              {canDeleteTeams && (
                <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void handleDelete(team.id); }} />
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
          {teams.map((team) => {
            const openDetail = () => router.push(recordHref(team));
            return (
            <TableRow
              key={team.id}
              data-shortcut-row={team.id}
              onClick={openDetail}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target === event.currentTarget) openDetail();
              }}
              tabIndex={0}
              className="cursor-pointer"
            >
              <TableCell className="font-mono text-muted-foreground text-xs">#{team.id}</TableCell>
              <TableCell className="font-mono text-primary text-sm">{team.code}</TableCell>
              <TableCell className="font-medium">{team.name}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{team.participationCount}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{team.organization ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{leaderName(team)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                  <a href={recordHref(team)} onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="sm" icon={Users} iconOnly tooltip="View team members" data-shortcut-primary />
                  </a>
                  {canManageTeams && (
                    <Button variant="ghost" size="sm" icon={Pencil} iconOnly tooltip="Edit team" onClick={() => startEdit(team)} />
                  )}
                  {canDeleteTeams && (
                    <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void handleDelete(team.id); }} />
                  )}
                </div>
              </TableCell>
            </TableRow>
            );
          })}
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
        navigation={navigation}
      />
    </div>
  );
}
