'use client';

import { useState } from 'react';

import { rotateContestAccounts } from '@/app/actions/contest-accounts';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

interface ContestOption {
  readonly id: number;
  readonly name: string;
}

interface TeamRotateAccountsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
  readonly teamId: number;
  readonly selectedUserIds: readonly number[];
  readonly contests: readonly ContestOption[];
  readonly copy: Dictionary['teams'];
}

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

/**
 * The day-2 action: rotate the selected accounts' display usernames in a contest and set this team
 * on them, as one write.
 *
 * WHY one dialog and not two buttons: the operator's day-two work was a username rotation and a
 * team assignment for the same roster, and running them separately leaves a window where the roster
 * is named for day two but still sits on the old team. The write goes through
 * `rotateContestAccounts`, which commits both in one transaction and audits them the way the panel
 * audits the same columns today.
 *
 * WHY the contest and the reason are required: a display username is scoped to one contest, so a
 * rotation that named no contest would have nothing to rename, and the write is an audited
 * correction, so it needs the reason the operator is making it.
 */
export function TeamRotateAccountsDialog({
  isOpen,
  onClose,
  onSuccess,
  teamId,
  selectedUserIds,
  contests,
  copy,
}: TeamRotateAccountsDialogProps): React.JSX.Element {
  const strings = copy.rotate;
  const [contestId, setContestId] = useState('');
  const [includeTeam, setIncludeTeam] = useState(true);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reset = (): void => {
    setContestId('');
    setIncludeTeam(true);
    setReason('');
    setMessage('');
    setError('');
  };

  const close = (): void => {
    if (loading) return;
    reset();
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    const contest = Number(contestId);
    if (!Number.isInteger(contest) || contest <= 0) {
      setError(strings.needContest);
      return;
    }
    if (reason.trim() === '') {
      setError(strings.needReason);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    const result = await rotateContestAccounts(contest, selectedUserIds, includeTeam ? teamId : null, reason);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? strings.failed);
      return;
    }
    setMessage(
      interpolate(strings.done, { rotated: result.rotated ?? 0, assigned: result.assigned ?? 0 }),
    );
    onSuccess();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) close(); }}
      title={strings.title}
      description={strings.description}
      className="sm:max-w-lg"
    >
      <div className="space-y-4">
        {error !== '' && <InlineAlert tone="destructive" density="regular">{error}</InlineAlert>}
        {message !== '' && <InlineAlert tone="success" density="regular">{message}</InlineAlert>}

        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{strings.contest}</span>
          <select id="team-rotate-contest" className={INPUT_CLASS} value={contestId} onChange={(event) => setContestId(event.target.value)}>
            <option value="">{strings.contestPlaceholder}</option>
            {contests.map((contest) => (
              <option key={contest.id} value={contest.id}>{contest.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary cursor-pointer"
            checked={includeTeam}
            onChange={(event) => setIncludeTeam(event.target.checked)}
          />
          {strings.teamToggle}
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{strings.reason}</span>
          <input id="team-rotate-reason" className={INPUT_CLASS} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close} disabled={loading}>
            {strings.cancel}
          </Button>
          <Button type="button" variant="positive" loading={loading} disabled={loading} onClick={() => { void handleSubmit(); }}>
            {interpolate(strings.run, { count: selectedUserIds.length })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
