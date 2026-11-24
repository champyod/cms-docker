import { CellText } from '@/components/core/CellText';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { TeamSummary } from '@/lib/people-read-model-types';

export function leaderName(team: TeamSummary, missing: string): string {
  if (!team.leader) return missing;
  return `${team.leader.firstName} ${team.leader.lastName}`.trim() || team.leader.username;
}

// One definition drives both layouts, and the missing-value word belongs to the dictionary.
export function buildTeamColumns(missing: string): ResponsiveColumn<TeamSummary>[] {
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
      render: (team) => <CellText width="sm" mono className="text-primary">{team.code ?? missing}</CellText>,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      cellClassName: 'min-w-[140px]',
      render: (team) => <CellText width="lg" bold>{team.name ?? missing}</CellText>,
    },
    {
      key: 'registerable',
      header: 'Registerable',
      cellClassName: 'w-28',
      hideOnMobile: true,
      render: (team) => <CellText width="sm" muted>{team.registerable === null ? missing : team.registerable ? 'Yes' : 'No'}</CellText>,
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
      render: (team) => <CellText width="md" muted>{team.organization ?? missing}</CellText>,
    },
    {
      key: 'leader',
      header: 'Leader',
      cellClassName: 'min-w-[120px]',
      render: (team) => <CellText width="md" muted>{leaderName(team, missing)}</CellText>,
    },
  ];
}
