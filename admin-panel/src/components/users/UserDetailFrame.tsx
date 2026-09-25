import type { UserSummary } from '@/lib/people-read-model-types';

export function UserDetailFrame({ summary }: { summary: UserSummary }): React.JSX.Element {
  const meta = [
    summary.status,
    summary.organization,
    summary.country,
    `${summary.participationCount} participations`,
  ].filter(Boolean);
  return <span className="text-muted-foreground">{meta.join(' · ')}</span>;
}
