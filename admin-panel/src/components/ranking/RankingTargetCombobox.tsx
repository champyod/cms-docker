'use client';

import { useEffect, useMemo, useState } from 'react';

import { FormField } from '@/components/core/FormField';

/** The minimum both the fetched kind list and a server match satisfy. */
export interface ComboboxOption {
  readonly key: string;
  readonly label: string;
  readonly kind?: string;
}

export interface RankingTargetComboboxProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly searchingLabel: string;
  readonly searchFailedLabel: string;
  readonly noMatchesLabel: string;
  /** The unique list fetched once for the chosen kind, filtered in the browser. */
  readonly options: readonly ComboboxOption[];
  readonly value: string;
  readonly onSelect: (option: ComboboxOption) => void;
  /** The server-side fuzzy search; the caller binds it to the chosen kind. */
  readonly search: (query: string) => Promise<readonly ComboboxOption[]>;
}

const DEBOUNCE_MS = 250;
const LIST_LIMIT = 50;

const FIELD_CLASSES =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
const LIST_CLASSES =
  'absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-lg';
const OPTION_CLASSES = 'cursor-pointer rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent';
const NOTE_CLASSES = 'px-2 py-1.5 text-sm text-muted-foreground';

function labelFor(options: readonly ComboboxOption[], value: string): string {
  return options.find((option) => option.key === value)?.label ?? value;
}

function matchesQuery(option: ComboboxOption, query: string): boolean {
  const needle = query.toLowerCase();
  return option.label.toLowerCase().includes(needle) || option.key.toLowerCase().includes(needle);
}

interface RemoteRead {
  readonly query: string;
  readonly matches: readonly ComboboxOption[];
  readonly failed: boolean;
}

/**
 * The server search, debounced while the reader types.
 *
 * WHY the pending flag is derived and not written: an answer belongs to the query it was asked
 * for, so a read is outstanding exactly while the last answer names a different query, and no
 * effect has to keep two states in step. WHY a failure is kept and not swallowed: a search that
 * fell over and a search that found nothing read the same to an operator but call for different
 * actions, so the dropdown says which happened.
 */
function useRemoteMatches(
  query: string,
  enabled: boolean,
  search: RankingTargetComboboxProps['search'],
): { readonly matches: readonly ComboboxOption[]; readonly searching: boolean; readonly failed: boolean } {
  const [read, setRead] = useState<RemoteRead>({ query: '', matches: [], failed: false });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      search(query)
        .then((rows) => {
          if (live) setRead({ query, matches: rows, failed: false });
        })
        .catch(() => {
          if (live) setRead({ query, matches: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, enabled, search]);

  const searching = enabled && read.query !== query;
  return { matches: searching ? [] : read.matches, searching, failed: !searching && read.failed };
}

interface OptionListProps {
  readonly listId: string;
  readonly visible: readonly ComboboxOption[];
  readonly selectedKey: string;
  readonly notice: string | null;
  readonly onChoose: (option: ComboboxOption) => void;
}

function OptionList({ listId, visible, selectedKey, notice, onChoose }: OptionListProps): React.JSX.Element {
  return (
    <ul id={listId} role="listbox" className={LIST_CLASSES}>
      {notice !== null && (
        <li role="presentation" className={NOTE_CLASSES}>
          {notice}
        </li>
      )}
      {visible.map((option) => (
        <li
          key={`${option.kind ?? ''}:${option.key}`}
          role="option"
          aria-selected={option.key === selectedKey}
          tabIndex={-1}
          // WHY the pointer-down is cancelled: without it the field's blur fires first and the
          // dropdown unmounts before the click that picks the row can land.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(option)}
          className={OPTION_CLASSES}
        >
          {option.label}
        </li>
      ))}
    </ul>
  );
}

interface ComboboxFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly text: string;
  readonly open: boolean;
  readonly choices: readonly ComboboxOption[];
  readonly selectedKey: string;
  readonly notice: string | null;
  readonly onChange: (text: string) => void;
  readonly onOpen: (open: boolean) => void;
  readonly onChoose: (option: ComboboxOption) => void;
}

function ComboboxField(props: ComboboxFieldProps): React.JSX.Element {
  const listId = `${props.id}-listbox`;
  return (
    <FormField id={props.id} label={props.label}>
      {(render) => (
        <div className="relative">
          <input
            {...render}
            type="text"
            role="combobox"
            aria-expanded={props.open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            className={FIELD_CLASSES}
            placeholder={props.placeholder}
            value={props.text}
            onChange={(event) => props.onChange(event.target.value)}
            onFocus={() => props.onOpen(true)}
            onBlur={() => props.onOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') props.onOpen(false);
            }}
          />
          {props.open ? (
            <OptionList
              listId={listId}
              visible={props.choices}
              selectedKey={props.selectedKey}
              notice={props.notice}
              onChoose={props.onChoose}
            />
          ) : null}
        </div>
      )}
    </FormField>
  );
}

function noticeFor(
  props: RankingTargetComboboxProps,
  searching: boolean,
  failed: boolean,
  empty: boolean,
): string | null {
  if (searching) return props.searchingLabel;
  if (failed) return props.searchFailedLabel;
  if (empty) return props.noMatchesLabel;
  return null;
}

/**
 * One control that is both a dropdown and a fuzzy search box.
 *
 * WHY one control: the fetched list answers "what exists for this kind" and the search answers
 * "which of them do I mean", so splitting them would make the operator choose between two ways of
 * naming the same target. The typed text is the query and never the submitted value — a hidden
 * field carries the key — so a target can only be picked, never spelled by hand. WHY an empty
 * query shows the label and not the raw key: the file is what the operator is about to edit, not
 * an identifier they are expected to recognise.
 */
export function RankingTargetCombobox(props: RankingTargetComboboxProps): React.JSX.Element {
  const { options, value, onSelect } = props;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const remote = query.trim() !== '';
  const { matches, searching, failed } = useRemoteMatches(query.trim(), remote, props.search);

  const visible = useMemo(
    () =>
      remote
        ? matches.slice(0, LIST_LIMIT)
        : options.filter((option) => query === '' || matchesQuery(option, query)).slice(0, LIST_LIMIT),
    [remote, matches, options, query],
  );

  const choose = (option: ComboboxOption): void => {
    setQuery('');
    setOpen(false);
    onSelect(option);
  };

  return (
    <ComboboxField
      id={props.id}
      label={props.label}
      placeholder={props.placeholder}
      text={remote ? query : labelFor(options, value)}
      open={open}
      choices={searching ? [] : visible}
      selectedKey={value}
      notice={noticeFor(props, searching, failed, visible.length === 0)}
      onChange={(next) => {
        setQuery(next);
        setOpen(true);
      }}
      onOpen={setOpen}
      onChoose={choose}
    />
  );
}
