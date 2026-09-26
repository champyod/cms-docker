import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { TeamSummary } from '@/lib/people-read-model-types';

export function leaderName(team: TeamSummary): string {
  if (!team.leader) return '—';
  return `${team.leader.firstName} ${team.leader.lastName}`.trim() || team.leader.username;
}

// Why one definition: the same columns drive the desktop table and the mobile
// cards, so a cell can no longer be edited in one layout and forgotten in the
// other. The hidden columns are the ones the mobile card never showed.
export function buildTeamColumns(): ResponsiveColumn<TeamSummary>[] {
  return [
    { key: 'id', header: 'ID', cellClassName: 'font-mono text-muted-foreground text-xs', hideOnMobile: true, render: (team) => <span>#{team.id}</span> },
    { key: 'code', header: 'Code', cellClassName: 'font-mono text-primary text-sm', render: (team) => <span>{team.code ?? '—'}</span> },
    { key: 'name', header: 'Name', cellClassName: 'font-medium', render: (team) => <span>{team.name ?? '—'}</span> },
    { key: 'members', header: 'Members', cellClassName: 'text-muted-foreground text-sm', render: (team) => <span>{team.participationCount}</span> },
    { key: 'organization', header: 'Organization', cellClassName: 'text-muted-foreground text-sm', hideOnMobile: true, render: (team) => <span>{team.organization ?? '—'}</span> },
    { key: 'leader', header: 'Leader', cellClassName: 'text-muted-foreground text-sm', render: (team) => <span>{leaderName(team)}</span> },
  ];
}
