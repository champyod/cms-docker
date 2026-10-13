'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Users } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { TeamBulkActionsDialog } from '@/components/teams/TeamBulkActionsDialog';
import { useAppRouter } from '@/hooks/useAppRouter';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { buildRoute } from '@/lib/navigation/routes';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { TeamMember } from '@/lib/people-read-model-types';

export interface TeamMembersTabProps {
  readonly teamId: number;
  readonly members: readonly TeamMember[];
  readonly permissionKeys: readonly string[];
  readonly contests: readonly { id: number; name: string }[];
  readonly navigation: Dictionary['navigation'];
  readonly copy: Dictionary['teams'];
  readonly locale: 'en' | 'th';
}

// Why: an unreadable user id is never inferred, so the record link is omitted
// instead of pointing at a row the reader may not open.
function memberProfileHref(locale: 'en' | 'th', member: TeamMember): string | null {
  if (member.userId === null) return null;
  return buildRoute(locale, 'people.user-tabs.profile', { id: member.userId });
}

function MemberRow({ member, locale, copy, selected, onToggle }: {
  readonly member: TeamMember;
  readonly locale: 'en' | 'th';
  readonly copy: Dictionary['teams'];
  readonly selected: boolean;
  readonly onToggle: (userId: number) => void;
}): React.JSX.Element {
  const href = memberProfileHref(locale, member);
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {member.userId !== null && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(member.userId as number)}
            aria-label={member.username ?? undefined}
          />
        )}
        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
          {(member.username ?? '—').substring(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium">{member.username ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || '—'}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member.contests.slice(0, 3).map((contest, index) => (
          <span key={`${contest.id ?? contest.name ?? 'contest'}-${index}`} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
            {contest.name ?? '—'}
          </span>
        ))}
        {member.contests.length > 3 && (
          <span className="text-xs text-muted-foreground">
            {interpolate(copy.members.moreCount, { count: member.contests.length - 3 })}
          </span>
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

export function TeamMembersTab({ teamId, members, permissionKeys, contests, navigation, copy, locale }: TeamMembersTabProps): React.JSX.Element {
  const router = useAppRouter();
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canUpdateTeam = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateTeam);
  const canUpdateParticipation = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateParticipation);
  const canBulk = canUpdateTeam || canUpdateParticipation;

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const toggle = (userId: number): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const bulkButton = canBulk ? (
    <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
      {copy.bulkActions.button}
    </Button>
  ) : null;

  const header = (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <span className="font-bold">
        {`${navigation.people['team-tabs'].members.label} (${members.length})`}
      </span>
      {bulkButton}
    </div>
  );

  const dialog = (
    <TeamBulkActionsDialog
      isOpen={dialogOpen}
      onClose={() => setDialogOpen(false)}
      onSuccess={() => { router.refresh(); }}
      teamId={teamId}
      selectedUserIds={[...selected]}
      contests={contests}
      canUpdateTeam={canUpdateTeam}
      canUpdateParticipation={canUpdateParticipation}
      copy={copy}
    />
  );

  if (members.length === 0) {
    return (
      <>
        <EmptyState
          icon={Users}
          title={copy.members.emptyTitle}
          description={copy.members.emptyDescription}
        />
        {bulkButton && <div className="mt-4 flex justify-end">{bulkButton}</div>}
        {dialog}
      </>
    );
  }

  return (
    <Card className="overflow-hidden">
      {header}
      <div className="divide-y divide-border">
        {members.map((member, index) => (
          // Why: an unreadable user id leaves only the row position to
          // distinguish two members, so it joins the readable key.
          <MemberRow
            key={`${member.userId ?? member.username ?? 'member'}-${index}`}
            member={member}
            locale={locale}
            copy={copy}
            selected={member.userId !== null && selected.has(member.userId)}
            onToggle={toggle}
          />
        ))}
      </div>
      {dialog}
    </Card>
  );
}
