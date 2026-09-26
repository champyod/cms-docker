import Link from 'next/link';
import { Users } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { buildRoute } from '@/lib/navigation/routes';
import type { UserTeamMembership } from '@/lib/people-read-model-types';

export interface UserTeamsTabProps {
  readonly memberships: readonly UserTeamMembership[];
  readonly navigation: Dictionary['navigation'];
  readonly copy: Dictionary['users'];
  readonly locale: 'en' | 'th';
}

function MembershipRow({ membership, copy, locale }: {
  readonly membership: UserTeamMembership;
  readonly copy: Dictionary['users'];
  readonly locale: 'en' | 'th';
}): React.JSX.Element {
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="font-medium">{membership.contestName}</div>
        <div className="text-xs text-muted-foreground">
          {interpolate(copy.teamsTab.contestLabel, { id: membership.contestId })}
        </div>
      </div>
      {membership.teamId !== null && membership.teamCode !== null ? (
        <Link
          href={buildRoute(locale, 'people.team-record', { id: membership.teamId })}
          className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono"
        >
          {membership.teamCode}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">{copy.teamsTab.noTeam}</span>
      )}
    </div>
  );
}

export function UserTeamsTab({ memberships, navigation, copy, locale }: UserTeamsTabProps): React.JSX.Element {
  if (memberships.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={copy.teamsTab.emptyTitle}
        description={copy.teamsTab.emptyDescription}
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="p-4 font-bold">{navigation.people['user-tabs'].teams.label}</div>
      <div className="divide-y divide-border">
        {memberships.map((membership) => (
          <MembershipRow key={membership.id} membership={membership} copy={copy} locale={locale} />
        ))}
      </div>
    </Card>
  );
}
