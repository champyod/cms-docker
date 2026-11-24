import Link from 'next/link';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { buildRoute } from '@/lib/navigation/routes';
import type { UserTeamMembership } from '@/lib/people-read-model-types';

export interface UserTeamsTabProps {
  readonly memberships: readonly UserTeamMembership[];
  readonly copy: Dictionary['users'];
  /** common.notSet: a row whose value the record does not hold. */
  readonly missing: string;
  readonly locale: 'en' | 'th';
}


function MembershipRow({ membership, copy, missing, locale }: {
  readonly membership: UserTeamMembership;
  readonly copy: Dictionary['users'];
  /** common.notSet: a row whose value the record does not hold. */
  readonly missing: string;
  readonly locale: 'en' | 'th';
}): React.JSX.Element {
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="font-medium">{membership.contestName ?? missing}</div>
        <div className="text-xs text-muted-foreground">
          {interpolate(copy.teamsTab.contestLabel, { id: membership.contestId ?? missing })}
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

export function UserTeamsTab({ memberships, copy, missing, locale }: UserTeamsTabProps): React.JSX.Element {
  return (
    <div className="divide-y divide-border">
      {memberships.map((membership) => (
        <MembershipRow key={membership.id} membership={membership} copy={copy} missing={missing} locale={locale} />
      ))}
    </div>
  );
}

/** What empty means here: no participation has been filed under a team yet. */
export function UserTeamsEmpty({ copy }: { readonly copy: Dictionary['users'] }): React.JSX.Element {
  return (
    <EmptyState
      icon={Users}
      title={copy.teamsTab.emptyTitle}
      description={copy.teamsTab.emptyDescription}
    />
  );
}
