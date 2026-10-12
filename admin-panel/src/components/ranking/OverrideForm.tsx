'use client';

import { useMemo, useState } from 'react';

import { saveRankingOverride } from '@/app/actions/rankingOverrides';
import { buildTeamSearcher, buildUserSearcher, type EntityHit } from '../palette/entity-searchers';
import { useEntitySearch } from '../palette/useEntitySearch';
import { buildNavVisibility } from '../palette/palette-data';
import { MIN_QUERY_LENGTH } from '../palette/search-scheduler';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50';
const LABEL_CLASS = 'block text-sm text-muted-foreground';

const ROW_ACTIONS: readonly string[] = ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'];
const RANKING_ACTIONS: readonly string[] = ['hide', 'freeze'];

interface OverrideFormCopy {
  readonly contestId: string;
  readonly target: string;
  readonly targetKey: string;
  readonly action: string;
  readonly actionHide: string;
  readonly actionGuest: string;
  readonly actionPin: string;
  readonly actionRename: string;
  readonly actionScore: string;
  readonly actionFreeze: string;
  readonly value: string;
  readonly reason: string;
  readonly add: string;
}

interface OverrideFormProps {
  readonly copy: OverrideFormCopy;
  readonly permissionKeys: readonly string[];
  readonly locale: string;
}

export function OverrideForm({ copy, permissionKeys, locale }: OverrideFormProps): React.JSX.Element {
  const [targetKind, setTargetKind] = useState('user');
  const [action, setAction] = useState('hide');
  const [keyDraft, setKeyDraft] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const actions = targetKind === 'ranking' ? RANKING_ACTIONS : ROW_ACTIONS;
  const keyDisabled = targetKind === 'ranking';
  const valueDisabled = action === 'hide';

  const visibility = useMemo(() => buildNavVisibility(permissionKeys), [permissionKeys]);
  const searchers = useMemo(() => {
    if (!visibility.users || keyDisabled) return [];
    return targetKind === 'team' ? [buildTeamSearcher(locale)] : [buildUserSearcher(locale)];
  }, [visibility, keyDisabled, targetKind, locale]);
  const { loading, hits } = useEntitySearch(dropdownOpen && !keyDisabled, keyDraft, searchers);
  const hasQuery = keyDraft.trim().length >= MIN_QUERY_LENGTH;
  const showDropdown = dropdownOpen && !keyDisabled && (loading || hits.length > 0 || hasQuery);

  const handleTargetKind = (next: string): void => {
    setTargetKind(next);
    if (next === 'ranking' && action !== 'hide' && action !== 'freeze') setAction('hide');
  };

  const fillForHit = (hit: EntityHit): string =>
    targetKind === 'team' ? hit.detail || hit.label : hit.label;

  const selectHit = (hit: EntityHit): void => {
    setKeyDraft(fillForHit(hit));
    setDropdownOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setDropdownOpen(false);
      return;
    }
    if (event.key === 'Enter' && dropdownOpen && hits.length > 0) {
      event.preventDefault();
      selectHit(hits[0]);
    }
  };

  return (
    <form action={saveRankingOverride} className="grid gap-3 md:grid-cols-2">
      <label className={LABEL_CLASS}>
        {copy.contestId}
        <input name="contestId" inputMode="numeric" required className={FIELD_CLASS} />
      </label>
      <label className={LABEL_CLASS}>
        {copy.target}
        <select
          name="targetKind"
          value={targetKind}
          onChange={(event) => handleTargetKind(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="user">user</option>
          <option value="team">team</option>
          <option value="ranking">ranking</option>
        </select>
      </label>
      <label className={keyDisabled ? `${LABEL_CLASS} opacity-50` : LABEL_CLASS}>
        {copy.targetKey}
        <div className="relative">
          <input
            name="targetKey"
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setDropdownOpen(false)}
            onKeyDown={handleKeyDown}
            required={!keyDisabled}
            disabled={keyDisabled}
            aria-disabled={keyDisabled}
            placeholder={keyDisabled ? '*' : undefined}
            autoComplete="off"
            className={FIELD_CLASS}
          />
          {showDropdown && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              {loading && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</li>
              )}
              {!loading && hits.map((hit) => (
                <li key={hit.key}>
                  <button
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); selectHit(hit); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                  >
                    <span className="flex-1 truncate">{hit.label}</span>
                    {hit.detail && <span className="text-xs text-muted-foreground">{hit.detail}</span>}
                  </button>
                </li>
              ))}
              {!loading && hasQuery && hits.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches</li>
              )}
            </ul>
          )}
        </div>
      </label>
      <label className={LABEL_CLASS}>
        {copy.action}
        <select
          name="action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className={FIELD_CLASS}
        >
          {actions.includes('hide') && <option value="hide">{copy.actionHide}</option>}
          {actions.includes('guest') && <option value="guest">{copy.actionGuest}</option>}
          {actions.includes('pin') && <option value="pin">{copy.actionPin}</option>}
          {actions.includes('rename') && <option value="rename">{copy.actionRename}</option>}
          {actions.includes('score') && <option value="score">{copy.actionScore}</option>}
          {actions.includes('freeze') && <option value="freeze">{copy.actionFreeze}</option>}
        </select>
      </label>
      <label className={valueDisabled ? `${LABEL_CLASS} opacity-50` : LABEL_CLASS}>
        {copy.value}
        <input
          name="value"
          disabled={valueDisabled}
          aria-disabled={valueDisabled}
          className={FIELD_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        {copy.reason}
        <input name="reason" required className={FIELD_CLASS} />
      </label>
      <button type="submit" className="rounded-xl bg-indigo-500/20 px-4 py-2 text-indigo-300">
        {copy.add}
      </button>
    </form>
  );
}
