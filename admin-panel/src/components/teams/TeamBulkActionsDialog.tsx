'use client';

import { useState } from 'react';

import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { InlineAlert } from '@/components/core/InlineAlert';
import { addUsersToTeamByUsername, applyTeamParticipationSettings } from '@/app/actions/team-members';
import { updateTeam } from '@/app/actions/teams';
import type { Dictionary } from '@/lib/dictionary';

interface ContestOption {
  id: number;
  name: string;
}

interface TeamBulkActionsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
  readonly teamId: number;
  readonly selectedUserIds: readonly number[];
  readonly contests: readonly ContestOption[];
  readonly canUpdateTeam: boolean;
  readonly canUpdateParticipation: boolean;
  readonly copy: Dictionary['teams'];
}

type TriState = 'no-change' | 'yes' | 'no';

const inputClassName = 'w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

function triStateToBoolean(value: TriState): boolean | undefined {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return undefined;
}

function optionalSeconds(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface FieldProps {
  readonly label: string;
  readonly children: React.ReactNode;
}

function Field({ label, children }: FieldProps): React.JSX.Element {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function TriStateSelect({ value, onChange, copy }: {
  readonly value: TriState;
  readonly onChange: (value: TriState) => void;
  readonly copy: Dictionary['teams'];
}): React.JSX.Element {
  return (
    <select className={inputClassName} value={value} onChange={(event) => onChange(event.target.value as TriState)}>
      <option value="no-change">{copy.bulkActions.noChange}</option>
      <option value="yes">{copy.bulkActions.yes}</option>
      <option value="no">{copy.bulkActions.no}</option>
    </select>
  );
}

export function TeamBulkActionsDialog({
  isOpen, onClose, onSuccess, teamId, selectedUserIds, contests,
  canUpdateTeam, canUpdateParticipation, copy,
}: TeamBulkActionsDialogProps): React.JSX.Element {
  const [registerable, setRegisterable] = useState<TriState>('no-change');
  const [contestId, setContestId] = useState('');
  const [usernames, setUsernames] = useState('');
  const [hidden, setHidden] = useState<TriState>('no-change');
  const [unrestricted, setUnrestricted] = useState<TriState>('no-change');
  const [extraTime, setExtraTime] = useState('');
  const [delayTime, setDelayTime] = useState('');
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reset = (): void => {
    setRegisterable('no-change'); setContestId(''); setUsernames('');
    setHidden('no-change'); setUnrestricted('no-change');
    setExtraTime(''); setDelayTime(''); setIp(''); setMessage(''); setError('');
  };

  const settingsRequested = hidden !== 'no-change' || unrestricted !== 'no-change'
    || optionalSeconds(extraTime) !== undefined || optionalSeconds(delayTime) !== undefined || ip.trim() !== '';

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const contest = Number(contestId);
      const hasContest = Number.isInteger(contest) && contest > 0;

      if (canUpdateTeam && registerable !== 'no-change') {
        const result = await updateTeam(teamId, { registerable: registerable === 'yes' });
        if (!result.success) { setError(result.error ?? copy.bulkActions.applied); return; }
      }

      const wanted = usernames.split(/[\n,]+/).map((name) => name.trim()).filter((name) => name.length > 0);
      if (wanted.length > 0) {
        if (!hasContest) { setError(copy.bulkActions.needContest); return; }
        const result = await addUsersToTeamByUsername(teamId, contest, wanted);
        if (!result.success) { setError(result.error ?? copy.bulkActions.applied); return; }
      }

      if (settingsRequested) {
        if (!canUpdateParticipation) { setError(copy.bulkActions.applied); return; }
        if (!hasContest) { setError(copy.bulkActions.needContest); return; }
        if (selectedUserIds.length === 0) { setError(copy.bulkActions.needMembers); return; }
        const hiddenValue = triStateToBoolean(hidden);
        const unrestrictedValue = triStateToBoolean(unrestricted);
        const extraTimeValue = optionalSeconds(extraTime);
        const delayTimeValue = optionalSeconds(delayTime);
        const result = await applyTeamParticipationSettings(contest, selectedUserIds, {
          ...(hiddenValue !== undefined ? { hidden: hiddenValue } : {}),
          ...(unrestrictedValue !== undefined ? { unrestricted: unrestrictedValue } : {}),
          ...(extraTimeValue !== undefined ? { extra_time_seconds: extraTimeValue } : {}),
          ...(delayTimeValue !== undefined ? { delay_time_seconds: delayTimeValue } : {}),
          ...(ip.trim() !== '' ? { ip } : {}),
        });
        if (!result.success) { setError(result.error ?? copy.bulkActions.applied); return; }
      }

      setMessage(copy.bulkActions.applied);
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const close = (): void => {
    if (loading) return;
    reset();
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) close(); }}
      title={copy.bulkActions.title}
      description={copy.bulkActions.description}
      className="sm:max-w-lg"
    >
      <form id="team-bulk-form" onSubmit={(event) => { void handleSubmit(event); }} className="space-y-4">
        {error && <InlineAlert tone="destructive" density="regular">{error}</InlineAlert>}
        {message && <InlineAlert tone="success" density="regular">{message}</InlineAlert>}

        {canUpdateTeam && (
          <Field label={copy.bulkActions.registerable}>
            <TriStateSelect value={registerable} onChange={setRegisterable} copy={copy} />
          </Field>
        )}

        <Field label={copy.bulkActions.contest}>
          <select className={inputClassName} value={contestId} onChange={(event) => setContestId(event.target.value)}>
            <option value="">{copy.bulkActions.contestPlaceholder}</option>
            {contests.map((contest) => (
              <option key={contest.id} value={contest.id}>{contest.name}</option>
            ))}
          </select>
        </Field>

        <Field label={copy.bulkActions.addUsers}>
          <textarea
            className={inputClassName}
            rows={2}
            value={usernames}
            onChange={(event) => setUsernames(event.target.value)}
            placeholder={copy.bulkActions.addUsersHint}
          />
        </Field>

        {canUpdateParticipation && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{copy.bulkActions.settings}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={copy.bulkActions.hidden}><TriStateSelect value={hidden} onChange={setHidden} copy={copy} /></Field>
              <Field label={copy.bulkActions.unrestricted}><TriStateSelect value={unrestricted} onChange={setUnrestricted} copy={copy} /></Field>
              <Field label={copy.bulkActions.extraTime}><input className={inputClassName} type="number" value={extraTime} onChange={(event) => setExtraTime(event.target.value)} /></Field>
              <Field label={copy.bulkActions.delayTime}><input className={inputClassName} type="number" value={delayTime} onChange={(event) => setDelayTime(event.target.value)} /></Field>
            </div>
            <Field label={copy.bulkActions.ip}><input className={inputClassName} value={ip} onChange={(event) => setIp(event.target.value)} /></Field>
          </fieldset>
        )}

        <ModalFooter
          formId="team-bulk-form"
          className="pt-2"
          cancelLabel={copy.bulkActions.cancel}
          confirmLabel={copy.bulkActions.apply}
          onCancel={close}
          confirmLoading={loading}
          confirmDisabled={loading}
        />
      </form>
    </Dialog>
  );
}
