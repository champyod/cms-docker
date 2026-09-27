// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import {
  isNestedRecordTabTransition,
  readListQuery,
  writeListQuery,
  type ListQueryState,
} from '@/lib/list-state';
import { useListSession } from '@/hooks/useListSession';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const DEFAULT_STATE: ListQueryState = { page: 1, perPage: 20, search: '' };

function queryOf(path: string): Record<string, string> {
  const query = path.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(query));
}

describe('readListQuery', () => {
  it('falls back to the first page, the default page size and an empty search', () => {
    expect(readListQuery({})).toEqual(DEFAULT_STATE);
  });

  it('reads the first value of a repeated parameter', () => {
    expect(readListQuery({ search: ['ada', 'grace'] })).toMatchObject({ search: 'ada' });
  });

  it('ignores a page or page size that is not a positive integer', () => {
    expect(readListQuery({ page: 'abc' })).toMatchObject({ page: 1 });
    expect(readListQuery({ page: '0' })).toMatchObject({ page: 1 });
    expect(readListQuery({ page: '-3' })).toMatchObject({ page: 1 });
    expect(readListQuery({ perPage: '1e5' })).toMatchObject({ perPage: 20 });
    expect(readListQuery({ perPage: '' })).toMatchObject({ perPage: 20 });
  });

  it('keeps sort and tab absent when the parameter is missing or empty', () => {
    expect(readListQuery({ sort: '', tab: '' })).toEqual(DEFAULT_STATE);
    expect(readListQuery({ sort: 'name', tab: 'overview' })).toMatchObject({ sort: 'name', tab: 'overview' });
  });
});

describe('writeListQuery', () => {
  it('leaves the path bare when every value is the default', () => {
    expect(writeListQuery('/en/people/users', DEFAULT_STATE)).toBe('/en/people/users');
  });

  it('writes only the values that differ from the defaults', () => {
    expect(writeListQuery('/en/people/users', { page: 3, perPage: 20, search: '' })).toBe('/en/people/users?page=3');
  });

  it('round-trips every non-default value through the parser', () => {
    const state: ListQueryState = { page: 4, perPage: 50, search: 'ada lovelace', sort: 'name', tab: 'overview' };
    const path = writeListQuery('/en/people/users', state);
    expect(readListQuery(queryOf(path))).toEqual(state);
  });

  it('normalises a page the read model cannot serve away to the default bare path', () => {
    // Why this direction: the address bar is the one place a reader can hand the
    // panel a page number with no rows behind it, and the canonical form of the
    // first page is the path with no query at all.
    expect(writeListQuery('/en/people/users', readListQuery(queryOf('/en/people/users?page=0')))).toBe('/en/people/users');
  });

  it('keeps a page the read model can serve', () => {
    expect(writeListQuery('/en/people/users', readListQuery(queryOf('/en/people/users?page=7')))).toBe('/en/people/users?page=7');
  });

  it('escapes a search term so the parser reads back what was written', () => {
    const path = writeListQuery('/en/people/users', { ...DEFAULT_STATE, search: 'a&b=c d' });
    expect(readListQuery(queryOf(path)).search).toBe('a&b=c d');
  });
});

describe('isNestedRecordTabTransition', () => {
  it('recognises a record tab opening under the record root', () => {
    expect(isNestedRecordTabTransition('/en/contests/5', '/en/contests/5/participants')).toBe(true);
  });

  it('recognises the same record tab closing back to the record root', () => {
    expect(isNestedRecordTabTransition('/en/contests/5/participants', '/en/contests/5')).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isNestedRecordTabTransition('/en/contests/5/', '/en/contests/5/teams')).toBe(true);
  });

  it('does not treat entering a record from its list as a tab switch', () => {
    expect(isNestedRecordTabTransition('/en/contests', '/en/contests/5')).toBe(false);
  });

  it('does not treat a sibling record as a tab switch', () => {
    expect(isNestedRecordTabTransition('/en/contests/5', '/en/contests/6')).toBe(false);
  });

  it('does not treat a sibling record tab as a tab switch', () => {
    expect(isNestedRecordTabTransition('/en/contests/5/participants', '/en/contests/5/settings')).toBe(false);
  });

  it('is false for the same path, which is not a transition at all', () => {
    expect(isNestedRecordTabTransition('/en/contests/5', '/en/contests/5')).toBe(false);
  });

  it('is false when nothing is shared', () => {
    expect(isNestedRecordTabTransition('/en/contests/5', '/en/tasks/9')).toBe(false);
  });
});

describe('list-state module boundary', () => {
  it('stays out of the registry, permission and redirect contracts', () => {
    // Why pinned here: this module is imported by feature pages that already own
    // route building and authorization. The moment it reaches for the registry it
    // can build a path the registry never declared, so the freeze is a test.
    const source = readFileSync('src/lib/list-state.ts', 'utf8');
    const imports = Array.from(source.matchAll(/^import .*$/gm)).map((match) => match[0]);
    expect(imports).toEqual([]);
    expect(source).not.toContain('lib/navigation/');
    expect(source).not.toContain('redirect(');
  });
});

describe('useListSession', () => {
  it('keys the session by the route id so two lists cannot share a selection', () => {
    const people = renderHook(() => useListSession('people.users'));
    const tasks = renderHook(() => useListSession('tasks.list'));
    act(() => people.result.current.setSelected('7', true));
    expect(people.result.current.selectedIds.has('7')).toBe(true);
    expect(tasks.result.current.selectedIds.has('7')).toBe(false);
  });

  it('keeps a selection across a remount on the same route id', () => {
    const first = renderHook(() => useListSession('people.users'));
    act(() => first.result.current.setSelected('7', true));
    first.unmount();
    const second = renderHook(() => useListSession('people.users'));
    expect(second.result.current.selectedIds.has('7')).toBe(true);
  });

  it('restores only the ids still present in the current rows', () => {
    const first = renderHook(() => useListSession('people.users'));
    act(() => {
      first.result.current.setSelected('7', true);
      first.result.current.setSelected('8', true);
    });
    first.unmount();
    const second = renderHook(() => useListSession('people.users'));
    act(() => second.result.current.restore(['8', '9']));
    expect([...second.result.current.selectedIds]).toEqual(['8']);
  });

  it('restores nothing for a route id that has no stored session', () => {
    const session = renderHook(() => useListSession('people.teams'));
    expect(session.result.current.selectedIds.size).toBe(0);
  });

  it('keeps the selection while a side panel is open', () => {
    const session = renderHook(() => useListSession('people.users'));
    act(() => session.result.current.setSelected('7', true));
    act(() => session.result.current.setPanelOpen(true));
    act(() => session.result.current.restore(['9']));
    expect(session.result.current.isSelected('7')).toBe(true);
  });

  it('filters the selection again once the side panel closes', () => {
    const session = renderHook(() => useListSession('people.users'));
    act(() => session.result.current.setSelected('7', true));
    act(() => session.result.current.setPanelOpen(true));
    act(() => session.result.current.restore(['9']));
    act(() => session.result.current.setPanelOpen(false));
    act(() => session.result.current.restore(['9']));
    expect(session.result.current.selectedIds.size).toBe(0);
  });

  it('clears the selection and the stored session on demand', () => {
    const session = renderHook(() => useListSession('people.users'));
    act(() => session.result.current.setSelected('7', true));
    act(() => session.result.current.clear());
    expect(session.result.current.selectedIds.size).toBe(0);
    const next = renderHook(() => useListSession('people.users'));
    expect(next.result.current.selectedIds.size).toBe(0);
  });
});
