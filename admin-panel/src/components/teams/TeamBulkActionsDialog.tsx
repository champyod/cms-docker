'use client';

import { useState } from 'react';

import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import { Select, type SelectOption } from '@/components/core/Select';
import { Textarea } from '@/components/core/Textarea';
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

function isTriState(value: string): value is TriState {
  return value === 'no-change' || value === 'yes' || value === 'no';
}

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

function triStateOptions(copy: Dictionary['teams']): readonly SelectOption[] {
  return [
    { value: 'no-change', label: copy.bulkActions.noChange },
    { value: 'yes', label: copy.bulkActions.yes },
    { value: 'no', label: copy.bulkActions.no },
  ];
}

interface TriStateFieldProps {
  readonly label: string;
  readonly value: TriState;
  readonly onChange: (value: TriState) => void;
  readonly copy: Dictionary['teams'];
}

function TriStateField({ label, value, onChange, copy }: TriStateFieldProps): React.JSX.Element {
  return (
    <Select
      label={label}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        if (isTriState(next)) onChange(next);
      }}
      options={triStateOptions(copy)}
    />
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
          <TriStateField
            label={copy.bulkActions.registerable}
            value={registerable}
            onChange={setRegisterable}
            copy={copy}
          />
        )}

        <Select
          label={copy.bulkActions.contest}
          value={contestId}
          onChange={(event) => setContestId(event.target.value)}
          options={[
            { value: '', label: copy.bulkActions.contestPlaceholder },
            ...contests.map((contest) => ({ value: String(contest.id), label: contest.name })),
          ]}
        />

        <Textarea
          label={copy.bulkActions.addUsers}
          rows={2}
          value={usernames}
          onChange={(event) => setUsernames(event.target.value)}
          placeholder={copy.bulkActions.addUsersHint}
        />

        {canUpdateParticipation && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{copy.bulkActions.settings}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TriStateField label={copy.bulkActions.hidden} value={hidden} onChange={setHidden} copy={copy} />
              <TriStateField label={copy.bulkActions.unrestricted} value={unrestricted} onChange={setUnrestricted} copy={copy} />
              <Input label={copy.bulkActions.extraTime} type="number" value={extraTime} onChange={(event) => setExtraTime(event.target.value)} />
              <Input label={copy.bulkActions.delayTime} type="number" value={delayTime} onChange={(event) => setDelayTime(event.target.value)} />
            </div>
            <Input label={copy.bulkActions.ip} value={ip} onChange={(event) => setIp(event.target.value)} />
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
