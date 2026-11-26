'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RotateCcw, Users } from 'lucide-react';

import { BulkActionBar } from '@/components/core/BulkActionBar';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { SELECTION_CHECKBOX_CLASS } from '@/components/core/SelectionColumn';
import { TeamBulkActionsDialog } from '@/components/teams/TeamBulkActionsDialog';
import { TeamRotateAccountsDialog } from '@/components/teams/TeamRotateAccountsDialog';
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

function matchesTerm(member: TeamMember, needle: string): boolean {
  if (needle === '') return true;
  const name = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim().toLowerCase();
  return (member.username ?? '').toLowerCase().includes(needle) || name.includes(needle);
}

function MemberRow({ member, locale, copy, selected, onToggle }: {
  readonly member: TeamMember;
  readonly locale: 'en' | 'th';
  readonly copy: Dictionary['teams'];
  readonly selected: boolean;
  readonly onToggle: (userId: number, checked: boolean) => void;
}): React.JSX.Element {
  const href = memberProfileHref(locale, member);
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {member.userId !== null && (
          <input
            type="checkbox"
            className={SELECTION_CHECKBOX_CLASS}
            checked={selected}
            onChange={(event) => onToggle(member.userId as number, event.target.checked)}
            aria-label={`${copy.members.selectRow} ${member.username ?? ''}`}
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

/**
 * A team's members, with the filter and the selection that drive the day-2 rotation.
 *
 * WHY the filter drives the list and the header cell selects what the filter matches: assigning a
 * team to a term's worth of accounts was one row at a time, and the day-two rotation was the same
 * work again. The select-all box walks the filtered set, so it never reaches a member the
 * operator's filter hid, and the toolbar states how many accounts the action will touch before it
 * runs.
 *
 * WHY this surface owns its own selection state: the ids here are users, the rows carry contests
 * and the action is scoped to this team, so the selection is this page's own — only the write
 * behind the toolbar is shared (`lib/panel-actions/contest-accounts`).
 */
export function TeamMembersTab({ teamId, members, permissionKeys, contests, navigation, copy, locale }: TeamMembersTabProps): React.JSX.Element {
  const router = useAppRouter();
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canUpdateTeam = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateTeam);
  const canUpdateParticipation = hasEffectivePermission(effective, ACTION_PERMISSIONS.updateParticipation);
  const canBulk = canUpdateTeam || canUpdateParticipation;
  const canRotate = hasEffectivePermission(effective, 'username:set');

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [term, setTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const needle = term.trim().toLowerCase();
  const filtered = useMemo(() => members.filter((member) => matchesTerm(member, needle)), [members, needle]);
  const filteredIds = useMemo(
    () => filtered.filter((member) => member.userId !== null).map((member) => member.userId as number),
    [filtered],
  );
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someSelected = filteredIds.some((id) => selected.has(id));

  const toggleAll = (checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of filteredIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleOne = (userId: number, checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const bulkButton = canBulk ? (
    <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
      {copy.bulkActions.button}
    </Button>
  ) : null;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <span className="pb-2 font-bold">
          {`${navigation.people['team-tabs'].members.label} (${members.length})`}
        </span>
        <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
          <input
            type="checkbox"
            className={SELECTION_CHECKBOX_CLASS}
            aria-label={copy.members.selectAll}
            title={copy.members.selectAll}
            checked={allSelected}
            ref={(node) => { if (node !== null) node.indeterminate = someSelected && !allSelected; }}
            onChange={(event) => toggleAll(event.target.checked)}
          />
          {copy.members.selectAll}
        </label>
        <Input
          id="team-member-filter"
          label={copy.members.filterPlaceholder}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>
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

  const rotateDialog = (
    <TeamRotateAccountsDialog
      isOpen={rotateOpen}
      onClose={() => setRotateOpen(false)}
      onSuccess={() => { setSelected(new Set()); router.refresh(); }}
      teamId={teamId}
      selectedUserIds={[...selected]}
      contests={contests}
      copy={copy}
    />
  );

  const toolbar = canRotate && selected.size > 0 ? (
    <div className="px-4 pb-4">
      <BulkActionBar
        selectedCount={selected.size}
        countLabel={copy.members.selectionCount}
        clearLabel={copy.members.selectionClear}
        onClear={() => setSelected(new Set())}
      >
        <Button type="button" variant="secondary" icon={RotateCcw} onClick={() => setRotateOpen(true)}>
          {copy.rotate.action}
        </Button>
      </BulkActionBar>
    </div>
  ) : null;

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
      {toolbar}
      <div className="divide-y divide-border">
        {filtered.map((member, index) => (
          // Why: an unreadable user id leaves only the row position to
          // distinguish two members, so it joins the readable key.
          <MemberRow
            key={`${member.userId ?? member.username ?? 'member'}-${index}`}
            member={member}
            locale={locale}
            copy={copy}
            selected={member.userId !== null && selected.has(member.userId)}
            onToggle={toggleOne}
          />
        ))}
        {filtered.length === 0 && <EmptyState icon={Users} title={copy.members.emptyTitle} description={copy.members.emptyDescription} />}
      </div>
      {dialog}
      {rotateDialog}
    </Card>
  );
}
