/**
 * Pure list query parsing and record-tab recognition.
 *
 * Why this module exists apart from the pages that need it: a list's page, page
 * size, search, sort and tab are one value that has to survive a copy of the
 * address bar, the back button and a refresh. Parsing it per page is how three
 * of those three drift apart.
 *
 * Why it knows nothing about the panel: this file is imported by feature pages
 * that already build their own base path with the route registry and already
 * authorize themselves. A helper that could also build a path, read a permission
 * or redirect would be a second, unchecked copy of those contracts, so the
 * surface here is deliberately limited to reading and writing query values.
 */

export interface ListQueryState {
  readonly page: number;
  readonly perPage: number;
  readonly search: string;
  readonly sort?: string;
  readonly tab?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MIN_POSITIVE = 1;
const INTEGER_PATTERN = /^\d+$/;

/**
 * A record route is locale / module / record id, so a shared prefix shorter
 * than this is a list-to-record navigation rather than a tab inside one record.
 */
const RECORD_SEGMENT_MINIMUM = 3;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function readPositiveInteger(value: string | string[] | undefined, fallback: number): number {
  const text = (firstValue(value) ?? '').trim();
  if (!INTEGER_PATTERN.test(text)) return fallback;
  const parsed = Number.parseInt(text, 10);
  return parsed >= MIN_POSITIVE ? parsed : fallback;
}

function pathSegments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

export function readListQuery(params: Readonly<Record<string, string | string[] | undefined>>): ListQueryState {
  const state: { page: number; perPage: number; search: string; sort?: string; tab?: string } = {
    page: readPositiveInteger(params.page, DEFAULT_PAGE),
    perPage: readPositiveInteger(params.perPage, DEFAULT_PER_PAGE),
    search: firstValue(params.search) ?? '',
  };
  const sort = firstValue(params.sort);
  if (sort !== undefined && sort !== '') state.sort = sort;
  const tab = firstValue(params.tab);
  if (tab !== undefined && tab !== '') state.tab = tab;
  return state;
}

export function writeListQuery(path: string, state: Partial<ListQueryState>): string {
  const params = new URLSearchParams();
  const page = state.page ?? DEFAULT_PAGE;
  const perPage = state.perPage ?? DEFAULT_PER_PAGE;
  const search = state.search ?? '';
  if (page !== DEFAULT_PAGE) params.set('page', String(page));
  if (perPage !== DEFAULT_PER_PAGE) params.set('perPage', String(perPage));
  if (search !== '') params.set('search', search);
  if (state.sort !== undefined && state.sort !== '') params.set('sort', state.sort);
  if (state.tab !== undefined && state.tab !== '') params.set('tab', state.tab);
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}

/**
 * True when one path is the other plus one or more nested segments, which is what
 * switching between a record's tabs looks like to the shell.
 *
 * Why the depth floor: `/contests` to `/contests/5` is a different page, and a
 * scroll reset there is the reader's only clue that the list ended.
 */
export function isNestedRecordTabTransition(previousPath: string, nextPath: string): boolean {
  const previous = pathSegments(previousPath);
  const next = pathSegments(nextPath);
  const shared = Math.min(previous.length, next.length);
  if (shared < RECORD_SEGMENT_MINIMUM) return false;
  for (let index = 0; index < shared; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return previous.length !== next.length;
}
