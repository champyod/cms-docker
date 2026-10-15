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
  readonly taskKeys: readonly RankingOverrideKey[];
  readonly contestId: string;
  readonly targetKind: string;
  readonly targetKey: string;
}

interface ValueControl {
  readonly type: 'number' | 'text';
  readonly inputMode: 'numeric' | 'decimal' | 'text';
}

// The value a verb needs is decided by the verb: a pin is a rank, a score is a
// number, a rename names a person and a guest names a stand-in. `freeze` carries the
// projection cutoff the board holds at; `hide` carries none.
const VALUE_CONTROLS: Readonly<Record<string, ValueControl>> = {
  hide: { type: 'text', inputMode: 'text' },
  guest: { type: 'text', inputMode: 'text' },
  pin: { type: 'number', inputMode: 'numeric' },
  rename: { type: 'text', inputMode: 'text' },
  score: { type: 'number', inputMode: 'decimal' },
  freeze: { type: 'number', inputMode: 'numeric' },
};

const USER_TEAM_VERBS: readonly string[] = ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'];

// WHY a task and a ranking accept fewer verbs than a user or a team: a task drops a
// board column and a ranking is the whole board, so neither can be renamed, pinned or
// scored, and the picker offers only what the chosen target can mean.
const KIND_VERBS: Readonly<Record<string, readonly string[]>> = {
  user: USER_TEAM_VERBS,
  team: USER_TEAM_VERBS,
  ranking: ['hide', 'freeze'],
  task: ['hide'],
};

// WHY the key options follow the kind: a team is named by its key, a task by the encoded
// name the projection carries and the whole board by one wildcard, so an operator never
// has to type a key the chosen target cannot hold.
function keyOptions(
  kind: string,
  userKeys: readonly RankingOverrideKey[],
  teamKeys: readonly string[],
  taskKeys: readonly RankingOverrideKey[],
): readonly RankingOverrideKey[] {
  if (kind === 'team') return teamKeys.map((name) => ({ key: name, label: name }));
  if (kind === 'ranking') return [{ key: '*', label: '*' }];
  if (kind === 'task') return taskKeys;
  return userKeys;
}

// The pickers are fed real rows and the value control follows the chosen verb, so an
// operator names a contest and a target that exist instead of typing a key by hand.
export function RankingOverrideForm({
  copy,
  contests,
  userKeys,
  teamKeys,
  taskKeys,
  contestId,
  targetKind,
  targetKey,
}: RankingOverrideFormProps): React.JSX.Element {
  const [kind, setKind] = useState(targetKind === '' ? 'user' : targetKind);
  const [action, setAction] = useState('hide');
  const keys = keyOptions(kind, userKeys, teamKeys, taskKeys);
  const verbs = KIND_VERBS[kind] ?? USER_TEAM_VERBS;
  const hideLabel = kind === 'task' ? copy.actionHideTask : copy.actionHide;
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
            if (!(KIND_VERBS[next] ?? USER_TEAM_VERBS).includes(action)) setAction('hide');
          }}
        >
          <option value="user">{copy.targetUser}</option>
          <option value="team">{copy.targetTeam}</option>
          <option value="ranking">{copy.targetRanking}</option>
          <option value="task">{copy.targetTask}</option>
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
          {verbs.includes('hide') && <option value="hide">{hideLabel}</option>}
          {verbs.includes('guest') && <option value="guest">{copy.actionGuest}</option>}
          {verbs.includes('pin') && <option value="pin">{copy.actionPin}</option>}
          {verbs.includes('rename') && <option value="rename">{copy.actionRename}</option>}
          {verbs.includes('score') && <option value="score">{copy.actionScore}</option>}
          {verbs.includes('freeze') && <option value="freeze">{copy.actionFreeze}</option>}
        </SelectField>
        {action !== 'hide' && valueControl !== undefined ? (
          <Input
            label={action === 'freeze' ? copy.freezeValue : copy.value}
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
