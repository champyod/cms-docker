import { CellText } from '@/components/core/CellText';
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
    {
      key: 'id',
      header: 'ID',
      sortKey: 'id',
      cellClassName: 'w-16',
      hideOnMobile: true,
      render: (team) => <CellText width="id" mono muted>#{team.id}</CellText>,
    },
    {
      key: 'code',
      header: 'Code',
      sortKey: 'code',
      cellClassName: 'w-24',
      render: (team) => <CellText width="sm" mono className="text-primary">{team.code ?? '—'}</CellText>,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      cellClassName: 'min-w-[140px]',
      render: (team) => <CellText width="lg" bold>{team.name ?? '—'}</CellText>,
    },
    {
      key: 'members',
      header: 'Members',
      sortKey: 'members',
      cellClassName: 'w-20 text-center',
      render: (team) => (
        <CellText width="id" mono muted className="text-center">
          {team.participationCount}
        </CellText>
      ),
    },
    {
      key: 'organization',
      header: 'Organization',
      sortKey: 'organization',
      cellClassName: 'min-w-[120px]',
      hideOnMobile: true,
      render: (team) => <CellText width="md" muted>{team.organization ?? '—'}</CellText>,
    },
    {
      key: 'leader',
      header: 'Leader',
      cellClassName: 'min-w-[120px]',
      render: (team) => <CellText width="md" muted>{leaderName(team)}</CellText>,
    },
  ];
}
