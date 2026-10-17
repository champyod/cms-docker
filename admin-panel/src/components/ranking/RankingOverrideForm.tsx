'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { searchRankingTargets } from '@/app/actions/ranking';
import { saveRankingOverride, saveRankingOverrides } from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { KIND_VERBS, OVERRIDE_ACTIONS } from '@/lib/ranking-override-verbs';
import { RankingTargetCombobox, type ComboboxOption } from '@/components/ranking/RankingTargetCombobox';

export type RankingOverrideCopy = Dictionary['ranking']['overrides'];

export interface RankingOverrideKey {
  readonly key: string;
  readonly label: string;
}

/** The pending row as the diff column reads it. */
export interface RankingOverrideDraft {
  readonly targetKind: string;
  readonly targetKey: string;
}

/**
 * The kinds the toolbar's first control offers.
 *
 * WHY only three: contest is wired (D2) and is not a target the operator picks as a kind, while
 * `ranking` is the whole board and not a target at all. Contest stays reachable through the
 * search — a contest match promotes the effective kind — so the menu is the three the operator
 * chooses between, not every kind the table may hold.
 */
const MENU_KINDS: readonly string[] = ['user', 'team', 'task'];

const VERB_ORDER: readonly string[] = ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'];

export interface RankingOverrideFormProps {
  readonly copy: RankingOverrideCopy;
  readonly contestId: string;
  readonly targetKind: string;
  readonly targetKey: string;
  readonly userKeys: readonly RankingOverrideKey[];
  readonly teamKeys: readonly string[];
  readonly contestKeys: readonly RankingOverrideKey[];
  readonly taskKeys: readonly RankingOverrideKey[];
  readonly onDraftChange?: (draft: RankingOverrideDraft) => void;
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

// WHY the key options follow the kind: a team is named by its key, a task by the composite
// contest/task key the projection carries, a contest by the encoded contest name the board files
// its tasks under, and the whole board by one wildcard, so an operator is never offered a key the
// chosen target cannot hold.
function keyOptions(
  kind: string,
  userKeys: readonly RankingOverrideKey[],
  teamKeys: readonly string[],
  contestKeys: readonly RankingOverrideKey[],
  taskKeys: readonly RankingOverrideKey[],
): readonly ComboboxOption[] {
  if (kind === 'team') return teamKeys.map((name) => ({ key: name, label: name }));
  if (kind === 'task') return taskKeys;
  if (kind === 'contest') return contestKeys;
  return userKeys;
}

function menuKindFor(targetKind: string): string {
  return MENU_KINDS.includes(targetKind) ? targetKind : 'user';
}

function scopeOf(contestId: string): number | null {
  const parsed = Number.parseInt(contestId, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function hideLabelFor(copy: RankingOverrideCopy, kind: string): string {
  if (kind === 'task') return copy.actionHideTask;
  if (kind === 'contest') return copy.actionHideContest;
  return copy.actionHide;
}

function KindField({
  copy,
  value,
  onChange,
}: {
  readonly copy: RankingOverrideCopy;
  readonly value: string;
  readonly onChange: (kind: string) => void;
}): React.JSX.Element {
  return (
    <SelectField
      id="ranking-override-kind"
      label={copy.target}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="user">{copy.targetUser}</option>
      <option value="team">{copy.targetTeam}</option>
      <option value="task">{copy.targetTask}</option>
    </SelectField>
  );
}

function ActionField({
  copy,
  verbs,
  action,
  hideLabel,
  onChange,
}: {
  readonly copy: RankingOverrideCopy;
  readonly verbs: readonly string[];
  readonly action: string;
  readonly hideLabel: string;
  readonly onChange: (action: string) => void;
}): React.JSX.Element {
  const labels: Readonly<Record<string, string>> = {
    hide: hideLabel,
    guest: copy.actionGuest,
    pin: copy.actionPin,
    rename: copy.actionRename,
    score: copy.actionScore,
    freeze: copy.actionFreeze,
  };
  return (
    <SelectField
      id="ranking-override-action"
      label={copy.action}
      name="action"
      value={action}
      onChange={(event) => onChange(event.target.value)}
    >
      {VERB_ORDER.filter((verb) => verbs.includes(verb)).map((verb) => (
        <option key={verb} value={verb}>
          {labels[verb]}
        </option>
      ))}
    </SelectField>
  );
}

function ValueField({ copy, action }: { readonly copy: RankingOverrideCopy; readonly action: string }): React.JSX.Element | null {
  const control = VALUE_CONTROLS[action];
  if (action === 'hide' || control === undefined) return null;
  return (
    <Input
      label={action === 'freeze' ? copy.freezeValue : copy.value}
      name="value"
      type={control.type}
      inputMode={control.inputMode}
    />
  );
}

interface DraftControls {
  readonly menuKind: string;
  readonly effectiveKind: string;
  readonly key: string;
  readonly action: string;
  readonly setAction: (action: string) => void;
  readonly chooseMenuKind: (kind: string) => void;
  readonly chooseTarget: (option: ComboboxOption) => void;
}

/**
 * WHY the draft lives in a hook: the menu kind, the effective kind, the picked key and the verb
 * move together — changing the menu kind clears a key the new kind cannot hold and drops a verb it
 * does not offer — so one owner keeps those rules in one place instead of spreading them across
 * the fields that render them.
 */
function useOverrideDraft(props: RankingOverrideFormProps): DraftControls {
  const [menuKind, setMenuKind] = useState(() => menuKindFor(props.targetKind));
  const [effectiveKind, setEffectiveKind] = useState(props.targetKind === '' ? 'user' : props.targetKind);
  const [key, setKey] = useState(props.targetKey);
  const [action, setAction] = useState('hide');
  const { onDraftChange } = props;
  useEffect(() => {
    onDraftChange?.({ targetKind: effectiveKind, targetKey: key });
  }, [effectiveKind, key, onDraftChange]);
  return {
    menuKind,
    effectiveKind,
    key,
    action,
    setAction,
    chooseMenuKind: (next) => {
      setMenuKind(next);
      setEffectiveKind(next);
      setKey('');
      if (!(KIND_VERBS[next] ?? OVERRIDE_ACTIONS).includes(action)) setAction('hide');
    },
    chooseTarget: (option) => {
      setEffectiveKind(option.kind ?? menuKind);
      setKey(option.key);
    },
  };
}

interface TargetPickerProps {
  readonly copy: RankingOverrideCopy;
  readonly contestId: string;
  readonly draft: DraftControls;
  readonly options: readonly ComboboxOption[];
  readonly search: (query: string) => Promise<readonly ComboboxOption[]>;
}

/**
 * The kind chooser and the one control that both lists that kind and searches it.
 *
 * WHY the key rides in a hidden field: the visible field holds what the operator typed or picked,
 * so the value the form submits is the key of a row that exists rather than a string typed into a
 * box. Contest is not a menu option, but a match from another kind promotes the effective kind, so
 * a contest or task stays reachable through the search.
 */
function TargetPicker({ copy, contestId, draft, options, search }: TargetPickerProps): React.JSX.Element {
  return (
    <>
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="targetKind" value={draft.effectiveKind} />
      <input type="hidden" name="targetKey" value={draft.key} />
      <KindField copy={copy} value={draft.menuKind} onChange={draft.chooseMenuKind} />
      <RankingTargetCombobox
        id="ranking-override-target"
        label={copy.targetKey}
        placeholder={copy.targetSearch}
        searchingLabel={copy.searching}
        searchFailedLabel={copy.searchFailed}
        noMatchesLabel={copy.noMatches}
        options={options}
        value={draft.key}
        onSelect={draft.chooseTarget}
        search={search}
      />
    </>
  );
}

/** One target the operator has queued for the batch, before the batch is filed. */
interface PendingTarget {
  readonly targetKind: string;
  readonly targetKey: string;
}

function pendingKey(entry: PendingTarget): string {
  return `${entry.targetKind}:${entry.targetKey}`;
}

/** The targets queued for the batch, so the operator sees the count before filing. */
function BatchQueue({
  copy,
  pending,
  onRemove,
}: {
  readonly copy: RankingOverrideCopy;
  readonly pending: readonly PendingTarget[];
  readonly onRemove: (key: string) => void;
}): React.JSX.Element | null {
  if (pending.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" data-batch-queue>
      {pending.map((entry) => (
        <li
          key={pendingKey(entry)}
          className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
        >
          <span>{`${entry.targetKind} ${entry.targetKey}`}</span>
          <button
            type="button"
            className="text-primary/70 hover:text-primary"
            aria-label={`${copy.batchRemove} ${entry.targetKey}`}
            onClick={() => onRemove(pendingKey(entry))}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The toolbar half of shape V2: the kind chooser and the fields that follow it, pinned above the
 * work they act on.
 *
 * WHY the submit sits at the end of the action row: the toolbar reads left to right as kind, then
 * target, then verb, then the value the verb needs, and the button that files the row belongs at
 * the end of that line rather than beside the target it acts on.
 *
 * WHY the queue and its own submit: filing an override for a whole selection is the same composed
 * correction applied to several targets, so the operator queues each target as they pick it and
 * files the batch once. The batch goes through `saveRankingOverrides` — the same shared
 * `addOverrides` the single row reaches through `saveRankingOverride` — so the vocabulary, the
 * scope check and the audit row are one implementation, and the button states the count it will
 * act on before it runs.
 */
export function RankingOverrideForm(props: RankingOverrideFormProps): React.JSX.Element {
  const { copy, contestId, userKeys, teamKeys, contestKeys, taskKeys } = props;
  const draft = useOverrideDraft(props);
  const [pending, setPending] = useState<readonly PendingTarget[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const options = useMemo(
    () => keyOptions(draft.effectiveKind, userKeys, teamKeys, contestKeys, taskKeys),
    [draft.effectiveKind, userKeys, teamKeys, contestKeys, taskKeys],
  );
  const scopedContest = scopeOf(contestId);
  const search = useCallback(
    (query: string) => searchRankingTargets(draft.effectiveKind, query, scopedContest),
    [draft.effectiveKind, scopedContest],
  );
  const verbs = KIND_VERBS[draft.effectiveKind] ?? OVERRIDE_ACTIONS;

  const queueTarget = (): void => {
    const key = draft.key.trim();
    if (key === '') {
      setError(copy.bulkAddNeedTargets);
      return;
    }
    const entry: PendingTarget = { targetKind: draft.effectiveKind, targetKey: key };
    setPending((previous) =>
      previous.some((row) => pendingKey(row) === pendingKey(entry)) ? previous : [...previous, entry],
    );
    setError(null);
  };

  const fileBatch = async (form: HTMLFormElement): Promise<void> => {
    const data = new FormData(form);
    const reason = String(data.get('reason') ?? '').trim();
    if (reason === '') {
      setError(copy.bulkAddNeedReason);
      return;
    }
    setFiling(true);
    setError(null);
    try {
      const filed = await saveRankingOverrides(
        pending.map((entry) => ({
          contestId,
          targetKind: entry.targetKind,
          targetKey: entry.targetKey,
          action: draft.action,
          value: String(data.get('value') ?? ''),
          reason,
        })),
      );
      setPending([]);
      setFeedback(interpolate(copy.addedMany, { count: filed }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.bulkAddFailed);
    } finally {
      setFiling(false);
    }
  };

  return (
    <form action={saveRankingOverride} className="space-y-3">
      <TargetPicker copy={copy} contestId={contestId} draft={draft} options={options} search={search} />
      <ActionField
        copy={copy}
        verbs={verbs}
        action={draft.action}
        hideLabel={hideLabelFor(copy, draft.effectiveKind)}
        onChange={draft.setAction}
      />
      <ValueField copy={copy} action={draft.action} />
      <Input label={copy.reason} name="reason" required />
      <BatchQueue
        copy={copy}
        pending={pending}
        onRemove={(key) => setPending((previous) => previous.filter((row) => pendingKey(row) !== key))}
      />
      {feedback !== null ? <p className="text-sm text-success">{feedback}</p> : null}
      {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
      <Stack direction="row" justify="end">
        <Button type="submit" variant="positive">
          {copy.add}
        </Button>
        <Button type="button" variant="secondary" onClick={queueTarget}>
          {copy.bulkAddToggle}
        </Button>
        {pending.length > 0 ? (
          <Button
            type="button"
            variant="positiveOutline"
            loading={filing}
            disabled={filing}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form !== null) void fileBatch(form);
            }}
          >
            {interpolate(copy.addMany, { count: pending.length })}
          </Button>
        ) : null}
      </Stack>
    </form>
  );
}
