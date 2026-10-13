'use client';

import { useState } from 'react';
import { ListChecks, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { InlineAlert } from '@/components/core/InlineAlert';
import { SectionCard } from '@/components/core/SectionCard';
import { SurfaceState } from '@/components/core/SurfaceState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import type { Dictionary } from '@/lib/dictionary';
import type { ContestRosterRow, ContestRosterState } from '@/lib/queries/contest-detail';
import {
  addTeamToRoster,
  listContestRoster,
  removeTeamFromRoster,
  setContestTeamRegisterable,
} from '@/app/actions/contestTeams';
import { cn } from '@/lib/utils';

type RosterCopy = Dictionary['contests']['roster'];

export type ContestRosterSectionProps = { contestId: number; permissionKeys: readonly string[] };

const CHIP_CLASSES = 'rounded-full px-2 py-0.5 text-xs';

const STATE_CHIP_CLASS: Record<ContestRosterState, string> = {
  inherited: 'bg-muted text-muted-foreground',
  registerable: 'bg-success/10 text-success',
  blocked: 'bg-destructive/10 text-destructive',
};

interface FeedbackLabels { pending: string; success: string; failure: string; }
interface WriteOutcome { success: boolean; error?: string; }

// The state is spelled out because inherited is not a third value: the chip names
// the team's own flag it falls back to, so no reader has to infer the outcome.
function stateLabel(copy: RosterCopy, row: ContestRosterRow): string {
  if (row.state === 'inherited') return row.registerable ? copy.inheritedOpen : copy.inheritedClosed;
  return row.state === 'registerable' ? copy.registerableOpen : copy.registerableClosed;
}

interface RosterRowProps {
  row: ContestRosterRow;
  copy: RosterCopy;
  canManage: boolean;
  busy: boolean;
  onSet: (teamId: number, registerable: boolean) => void;
  onAdd: (teamId: number) => void;
  onRemove: (teamId: number) => void;
}

function ContestRosterRow({ row, copy, canManage, busy, onSet, onAdd, onRemove }: RosterRowProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{row.code.substring(0, 2).toUpperCase()}</div>
        <div>
          <div className="font-medium text-foreground">{row.code}</div>
          <div className="text-xs text-muted-foreground">{row.name}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn(CHIP_CLASSES, STATE_CHIP_CLASS[row.state])}>{stateLabel(copy, row)}</span>
        {canManage && (
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={row.registerable}
                disabled={busy}
                onChange={(event) => onSet(row.teamId, event.target.checked)}
              />
              {copy.toggle}
            </label>
            {row.state === 'inherited'
              ? <Button variant="secondary" size="sm" icon={Plus} disabled={busy} onClick={() => onAdd(row.teamId)}>{copy.add}</Button>
              : <Button variant="ghost" size="sm" icon={RotateCcw} disabled={busy} onClick={() => onRemove(row.teamId)}>{copy.remove}</Button>}
          </>
        )}
      </div>
    </div>
  );
}

interface RosterMutations {
  busyTeamId: number | null;
  setRegisterable: (teamId: number, registerable: boolean) => void;
  add: (teamId: number) => void;
  remove: (teamId: number) => void;
}

function useRosterMutations(contestId: number, copy: RosterCopy, reload: () => void): RosterMutations {
  const [busyTeamId, setBusyTeamId] = useState<number | null>(null);
  const runAction = useActionFeedback();

  const run = async (teamId: number, labels: FeedbackLabels, write: () => Promise<WriteOutcome>): Promise<void> => {
    setBusyTeamId(teamId);
    try {
      const result = await runAction(labels, write);
      if (result?.success) reload();
    } finally {
      setBusyTeamId(null);
    }
  };

  return {
    busyTeamId,
    setRegisterable: (teamId, registerable) => {
      void run(teamId, { pending: copy.setPending, success: copy.setSuccess, failure: copy.setFailure }, () => setContestTeamRegisterable(contestId, teamId, registerable));
    },
    add: (teamId) => {
      void run(teamId, { pending: copy.addPending, success: copy.addSuccess, failure: copy.addFailure }, () => addTeamToRoster(contestId, teamId));
    },
    remove: (teamId) => {
      void run(teamId, { pending: copy.removePending, success: copy.removeSuccess, failure: copy.removeFailure }, () => removeTeamFromRoster(contestId, teamId));
    },
  };
}

/** Which teams registration may offer for the contest already open, and who decides it. */
export function ContestRosterSection({ contestId, permissionKeys }: ContestRosterSectionProps): React.JSX.Element {
  const dict = useDictionary();
  const copy = dict.contests.roster;
  const [expanded, setExpanded] = useState(true);
  const { data, status, reload } = useSurfaceLoad(() => listContestRoster(contestId), surfaceLoadMessages(dict));
  const mutations = useRosterMutations(contestId, copy, reload);
  // Why the map entry: the button that offers the write and the action that performs
  // it must read one key, and this one is already claimed by the team form.
  const canManage = hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.updateTeam);
  const rows = data ?? [];
  const loaded = status.kind === 'idle';

  return (
    <SectionCard
      title={copy.title}
      icon={<ListChecks className="h-5 w-5 text-primary" />}
      count={loaded ? rows.length : undefined}
      expanded={expanded}
      onToggle={() => setExpanded((previous) => !previous)}
    >
      <div className="border-b border-border bg-muted/20 p-4 text-xs text-muted-foreground">{copy.description}</div>
      <SurfaceState status={status} />
      {loaded && (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <ContestRosterRow
              key={row.teamId}
              row={row}
              copy={copy}
              canManage={canManage}
              busy={mutations.busyTeamId === row.teamId}
              onSet={mutations.setRegisterable}
              onAdd={mutations.add}
              onRemove={mutations.remove}
            />
          ))}
          {rows.length === 0 && <EmptyState icon={ListChecks} title={copy.empty} />}
        </div>
      )}
      {loaded && !canManage && (
        <div className="p-4">
          <InlineAlert tone="info" density="compact" announce="polite">{copy.readOnly}</InlineAlert>
        </div>
      )}
    </SectionCard>
  );
}
