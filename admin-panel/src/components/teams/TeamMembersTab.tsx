import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { TeamMember } from '@/lib/people-read-model-types';

export interface TeamMembersTabProps {
  readonly members: readonly TeamMember[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: 'en' | 'th';
}

// Why: an unreadable user id is never inferred, so the record link is omitted
// instead of pointing at a row the reader may not open.
function memberProfileHref(locale: 'en' | 'th', member: TeamMember): string | null {
  if (member.userId === null) return null;
  return buildRoute(locale, 'people.user-tabs.profile', { id: member.userId });
}

function MemberRow({ member, locale }: { readonly member: TeamMember; readonly locale: 'en' | 'th' }): React.JSX.Element {
  const href = memberProfileHref(locale, member);
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
          {(member.username ?? '—').substring(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium">{member.username ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || '—'}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member.contests.slice(0, 3).map((contest) => (
          <span key={contest.id} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
            {contest.name}
          </span>
        ))}
        {member.contests.length > 3 && (
          <span className="text-xs text-muted-foreground">{`+${member.contests.length - 3} more`}</span>
        )}
        {href && (
          <Link href={href} className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors" aria-label={member.username ?? undefined}>
            <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function TeamMembersTab({ members, navigation, locale }: TeamMembersTabProps): React.JSX.Element {
  if (members.length === 0) {
    return <EmptyState icon={Users} title="No members in this team yet." description="Add members by assigning this team to a participation in a contest." />;
  }
  return (
    <Card className="overflow-hidden">
      <div className="p-4 font-bold">
        {`${navigation.people['team-tabs'].members.label} (${members.length})`}
      </div>
      <div className="divide-y divide-border">
        {members.map((member, index) => (
          // Why: an unreadable user id leaves only the row position to
          // distinguish two members, so it joins the readable key.
          <MemberRow key={`${member.userId ?? member.username ?? 'member'}-${index}`} member={member} locale={locale} />
        ))}
      </div>
    </Card>
  );
}
