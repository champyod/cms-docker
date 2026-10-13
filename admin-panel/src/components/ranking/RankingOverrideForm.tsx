'use client';

import React, { useState } from 'react';

import { saveRankingOverride } from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Grid } from '@/components/core/Layout';
import type { Dictionary } from '@/lib/dictionary';

export type RankingOverrideCopy = Dictionary['ranking']['overrides'];

export interface RankingOverrideContest {
  readonly id: number;
  readonly name: string;
}

export interface RankingOverrideKey {
  readonly key: string;
  readonly label: string;
}

export interface RankingOverrideFormProps {
  readonly copy: RankingOverrideCopy;
  readonly contests: readonly RankingOverrideContest[];
  readonly userKeys: readonly RankingOverrideKey[];
  readonly teamKeys: readonly string[];
  readonly contestId: string;
  readonly targetKind: string;
  readonly targetKey: string;
}

interface ValueControl {
  readonly type: 'number' | 'text';
  readonly inputMode: 'numeric' | 'decimal' | 'text';
}

// The value a verb needs is decided by the verb: a pin is a rank and a score is a
// number, a rename names a person and a guest names a stand-in. `hide` and
// `freeze` carry none: freeze pins the shown score, so the server drops any value.
const VALUE_CONTROLS: Readonly<Record<string, ValueControl>> = {
  hide: { type: 'text', inputMode: 'text' },
  guest: { type: 'text', inputMode: 'text' },
  pin: { type: 'number', inputMode: 'numeric' },
  rename: { type: 'text', inputMode: 'text' },
  score: { type: 'number', inputMode: 'decimal' },
};

// The pickers are fed real rows and the value control follows the chosen verb, so an
// operator names a contest and a target that exist instead of typing a key by hand.
export function RankingOverrideForm({
  copy,
  contests,
  userKeys,
  teamKeys,
  contestId,
  targetKind,
  targetKey,
}: RankingOverrideFormProps): React.JSX.Element {
  const [kind, setKind] = useState(targetKind === '' ? 'user' : targetKind);
  const [action, setAction] = useState('hide');
  const keys: readonly RankingOverrideKey[] =
    kind === 'team'
      ? teamKeys.map((name) => ({ key: name, label: name }))
      : kind === 'ranking'
        ? [{ key: '*', label: '*' }]
        : userKeys;
  const verbs: readonly string[] =
    kind === 'ranking' ? ['hide', 'freeze'] : ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'];
  const valueControl = VALUE_CONTROLS[action];
  return (
    <form action={saveRankingOverride}>
      <Grid cols={2} gap={3}>
        <SelectField
          id="ranking-override-contest"
          label={copy.contestId}
          name="contestId"
          defaultValue={contestId}
          required
        >
          <option value="">{copy.chooseContest}</option>
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>
              #{contest.id} — {contest.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="ranking-override-kind"
          label={copy.target}
          name="targetKind"
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            setKind(next);
            if (next === 'ranking' && action !== 'hide' && action !== 'freeze') setAction('hide');
          }}
        >
          <option value="user">{copy.targetUser}</option>
          <option value="team">{copy.targetTeam}</option>
          <option value="ranking">{copy.targetRanking}</option>
        </SelectField>
        <SelectField
          id="ranking-override-key"
          label={copy.targetKey}
          name="targetKey"
          defaultValue={targetKey}
          required
        >
          <option value="">{copy.chooseTargetKey}</option>
          {keys.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="ranking-override-action"
          label={copy.action}
          name="action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          {verbs.includes('hide') && <option value="hide">{copy.actionHide}</option>}
          {verbs.includes('guest') && <option value="guest">{copy.actionGuest}</option>}
          {verbs.includes('pin') && <option value="pin">{copy.actionPin}</option>}
          {verbs.includes('rename') && <option value="rename">{copy.actionRename}</option>}
          {verbs.includes('score') && <option value="score">{copy.actionScore}</option>}
          {verbs.includes('freeze') && <option value="freeze">{copy.actionFreeze}</option>}
        </SelectField>
        {action !== 'hide' && valueControl !== undefined ? (
          <Input
            label={copy.value}
            name="value"
            type={valueControl.type}
            inputMode={valueControl.inputMode}
          />
        ) : null}
        <Input label={copy.reason} name="reason" required />
        <Button type="submit" variant="positive">
          {copy.add}
        </Button>
      </Grid>
    </form>
  );
}
