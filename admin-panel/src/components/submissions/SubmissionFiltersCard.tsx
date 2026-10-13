'use client';

import { useState } from 'react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';

/** The contest/task/user narrowing the list query supports, plus the free-text search. */
export interface SubmissionFilters {
  readonly contestId?: number;
  readonly taskId?: number;
  readonly userId?: number;
  /** Free text matching a submission id or the contestant's username. */
  readonly search?: string;
}

/** A positive integer, or undefined for blank and for anything that is not one. */
function readId(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The narrowing controls, driven entirely by the URL.
 *
 * WHY a form and not local state: the filter is a property of the view, not of the
 * component, so it belongs in the address bar — an operator can share or bookmark the
 * exact list they are looking at, and a reload keeps it. Every push resets the page,
 * because page 4 of the unfiltered list is not page 4 of a filtered one.
 *
 * WHY the labels are literal strings: the list already renders its own copy that way
 * ("No submissions found", and the pager's "Page 1 of 2"), so it matches the list's
 * existing convention rather than inventing a second one for these fields. They should
 * move into the dictionary with the rest of the list's copy.
 */
export function SubmissionFiltersCard({
  filters,
  onApply,
}: {
  readonly filters: SubmissionFilters;
  readonly onApply: (next: SubmissionFilters) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState(filters.search ?? '');
  const [contest, setContest] = useState(filters.contestId === undefined ? '' : String(filters.contestId));
  const [task, setTask] = useState(filters.taskId === undefined ? '' : String(filters.taskId));
  const [user, setUser] = useState(filters.userId === undefined ? '' : String(filters.userId));

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const term = search.trim();
    onApply({
      ...(term === '' ? {} : { search: term }),
      ...(readId(contest) === undefined ? {} : { contestId: readId(contest) }),
      ...(readId(task) === undefined ? {} : { taskId: readId(task) }),
      ...(readId(user) === undefined ? {} : { userId: readId(user) }),
    });
  };

  const clear = (): void => {
    setSearch('');
    setContest('');
    setTask('');
    setUser('');
    onApply({});
  };

  const hasAny = search !== '' || contest !== '' || task !== '' || user !== '';

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Input
          label="Search"
          name="search"
          value={search}
          placeholder="Submission id or username"
          onChange={(event) => setSearch(event.target.value)}
          className="w-56"
        />
        <Input
          label="Contest id"
          name="contest"
          inputMode="numeric"
          value={contest}
          onChange={(event) => setContest(event.target.value)}
          className="w-28"
        />
        <Input
          label="Task id"
          name="task"
          inputMode="numeric"
          value={task}
          onChange={(event) => setTask(event.target.value)}
          className="w-28"
        />
        <Input
          label="User id"
          name="user"
          inputMode="numeric"
          value={user}
          onChange={(event) => setUser(event.target.value)}
          className="w-28"
        />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {hasAny ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </form>
    </Card>
  );
}
