import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { UserTeamMembership } from '@/lib/people-read-model-types';

export interface UserTeamsTabProps {
  readonly memberships: readonly UserTeamMembership[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: 'en' | 'th';
}

export function UserTeamsTab({ memberships, navigation, locale }: UserTeamsTabProps): React.JSX.Element {
  if (memberships.length === 0) {
    return <EmptyState icon={Users} title="No teams found." description="This user is not assigned to any team yet." />;
  }
  return (
    <Card className="overflow-hidden">
      <div className="p-4 font-bold">{navigation.people['user-tabs'].teams.label}</div>
      <div className="divide-y divide-border">
        {memberships.map((membership) => (
          <div key={membership.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">{membership.contestName}</div>
              <div className="text-xs text-muted-foreground">Contest #{membership.contestId}</div>
            </div>
            {membership.teamId !== null && membership.teamCode !== null ? (
              <Link
                href={buildRoute(locale, 'people.team-record', { id: membership.teamId })}
                className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono"
              >
                {membership.teamCode}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">No team</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
