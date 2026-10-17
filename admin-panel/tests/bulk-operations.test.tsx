// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  endRankingOverrides: vi.fn(async () => 1),
  saveRankingOverride: vi.fn(),
  saveRankingOverrides: vi.fn(async () => 1),
  detachContestTasks: vi.fn(async () => ({ success: true, changed: 1, error: undefined as string | undefined })),
  attachContestTasks: vi.fn(async () => ({ success: true, changed: 0 })),
  rotateContestAccounts: vi.fn(async () => ({ success: true, rotated: 2, assigned: 2 })),
  addUsersToTeamByUsername: vi.fn(),
  applyTeamParticipationSettings: vi.fn(),
  updateTeam: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/ranking/users',
}));
vi.mock('@/app/actions/ranking', () => ({
  getRankingImpact: vi.fn(),
  searchRankingTargets: vi.fn(async () => []),
}));
vi.mock('@/app/actions/rankingOverrides', () => ({
  endRankingOverrides: mocks.endRankingOverrides,
  saveRankingOverride: mocks.saveRankingOverride,
  saveRankingOverrides: mocks.saveRankingOverrides,
}));
vi.mock('@/app/actions/contest-tasks', () => ({
  detachContestTasks: mocks.detachContestTasks,
  attachContestTasks: mocks.attachContestTasks,
}));
vi.mock('@/app/actions/contest-accounts', () => ({
  rotateContestAccounts: mocks.rotateContestAccounts,
}));
vi.mock('@/app/actions/team-members', () => ({
  addUsersToTeamByUsername: mocks.addUsersToTeamByUsername,
  applyTeamParticipationSettings: mocks.applyTeamParticipationSettings,
}));
vi.mock('@/app/actions/teams', () => ({ updateTeam: mocks.updateTeam }));

import { ContestTasksSection } from '@/components/contests/contest-detail/ContestTasksSection';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { RankingOverrideForm } from '@/components/ranking/RankingOverrideForm';
import { RankingOverrideList } from '@/components/ranking/RankingOverrideList';
import { TeamMembersTab } from '@/components/teams/TeamMembersTab';
import { UserListTable } from '@/components/users/UserListTable';
import type { UserSelection } from '@/components/users/useUserSelection';
import type { UserListRows } from '@/components/users/useUserListRows';
import en from '@/dictionaries/en.json';
import { interpolate } from '@/lib/interpolate';
import type { RankingOverride } from '@/app/actions/rankingOverrides';
import type { UsersPageRow } from '@/lib/prisma-selects';

const OVERRIDE_COPY = en.ranking.overrides;
const TASK_COPY = en.tasks.contestTasks;
const TEAM_COPY = en.teams;

function withDictionary(node: React.JSX.Element): React.JSX.Element {
  return <DictionaryProvider dict={en}>{node}</DictionaryProvider>;
}

function buttonWithText(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === label) ?? null
  );
}

function userRow(id: number): UsersPageRow {
  return {
    id,
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: `ada${id}`,
    email: null,
    timezone: null,
    preferred_languages: [],
    status: 'active',
    organization: null,
    country: null,
    participations: [],
    _count: { participations: 0 },
  } as unknown as UsersPageRow;
}

function override(id: string, targetKey: string, reason: string): RankingOverride {
  return {
    id,
    contestId: 9,
    targetKind: 'user',
    targetKey,
    action: 'hide',
    value: '',
    reason,
    createdAt: '2026-10-15T00:00:00.000Z',
  } as unknown as RankingOverride;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Why: the selection store is keyed by route, so a selection left behind by one case would be
// restored by the next one and the assertions would read a selection the operator never made.
beforeEach(() => {
  window.sessionStorage.clear();
});

describe('users list select-all', () => {
  it('selects every row the filter matches, not the page on screen', () => {
    const rows = {
      users: [userRow(1), userRow(2)],
      filteredIds: [1, 2, 3, 4, 5],
      table: { page: 1, perPage: 2 },
      loading: false,
      sort: null,
      setSort: vi.fn(),
    } as unknown as UserListRows;
    const selection = {
      selectedIds: new Set<number>(),
      selectedUsers: [],
      missingCount: 0,
      toggleOne: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
    } as unknown as UserSelection;

    const { container } = render(
      withDictionary(
        <UserListTable
          rows={rows}
          selection={selection}
          permissionKeys={[]}
          selectAllLabel={en.users.selectAllFiltered}
          onOpen={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );

    const box = container.querySelector<HTMLInputElement>(
      `input[aria-label="${en.users.selectAllFiltered}"]`,
    );
    if (box === null) throw new Error('the header select-all box is missing');
    fireEvent.click(box);

    expect(selection.setMany).toHaveBeenCalledWith([1, 2, 3, 4, 5], true);
  });
});

describe('ranking override list bulk end', () => {
  it('selects only the filtered rows and ends exactly those, reporting the count', async () => {
    const { container } = render(
      withDictionary(
        <RankingOverrideList
          copy={OVERRIDE_COPY}
          rows={[override('1', 'ada', 'test account'), override('2', 'bob', 'preserve account')]}
          orphanContestIds={[]}
          canOverride
        />,
      ),
    );

    const search = container.querySelector<HTMLInputElement>('#ranking-override-filter-search');
    if (search === null) throw new Error('the filter search is missing');
    fireEvent.change(search, { target: { value: 'preserve' } });

    const box = container.querySelector<HTMLInputElement>(
      `input[aria-label="${OVERRIDE_COPY.selectAll}"]`,
    );
    if (box === null) throw new Error('the header select-all box is missing');
    fireEvent.click(box);

    // Why this is the whole point of the case: row 1 is filtered out, so a selection that reached
    // past the filter would say "End 2 selected" here.
    const bulkEnd = buttonWithText(container, interpolate(OVERRIDE_COPY.endSelectedCount, { count: 1 }));
    if (bulkEnd === null) throw new Error('the bulk end button does not carry the filtered count');
    fireEvent.click(bulkEnd);

    const reason = document.querySelector<HTMLInputElement>('#name-dialog-value');
    if (reason === null) throw new Error('the reason dialog did not open');
    fireEvent.change(reason, { target: { value: 'duplicate account' } });

    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) throw new Error('the reason dialog did not render');
    const confirm = buttonWithText(dialog, OVERRIDE_COPY.end);
    if (confirm === null) throw new Error('the dialog has no confirm button');
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.endRankingOverrides).toHaveBeenCalledWith([2], 'duplicate account'));
    await waitFor(() => expect(container.textContent).toContain(interpolate(OVERRIDE_COPY.endedSelected, { count: 1 })));
  });
});

describe('ranking override form bulk add', () => {
  it('files a queued multi-target batch through the shared write path', async () => {
    const { container } = render(
      withDictionary(
        <RankingOverrideForm
          copy={OVERRIDE_COPY}
          contestId="9"
          targetKind="user"
          targetKey=""
          userKeys={[{ key: 'ada', label: 'Ada Lovelace' }]}
          teamKeys={[]}
          contestKeys={[]}
          taskKeys={[]}
        />,
      ),
    );

    const target = container.querySelector<HTMLInputElement>('#ranking-override-target');
    if (target === null) throw new Error('the target combobox is missing');
    fireEvent.focus(target);
    const option = container.querySelector('#ranking-override-target-listbox li[role="option"]');
    if (option === null) throw new Error('the dropdown listed no option');
    fireEvent.click(option);

    const reason = container.querySelector<HTMLInputElement>('input[name="reason"]');
    if (reason === null) throw new Error('the reason field is missing');
    fireEvent.change(reason, { target: { value: 'day two' } });

    const queue = buttonWithText(container, OVERRIDE_COPY.bulkAddToggle);
    if (queue === null) throw new Error('the queue button is missing');
    fireEvent.click(queue);

    const file = buttonWithText(container, interpolate(OVERRIDE_COPY.addMany, { count: 1 }));
    if (file === null) throw new Error('the file button does not carry the queued count');
    fireEvent.click(file);

    await waitFor(() =>
      expect(mocks.saveRankingOverrides).toHaveBeenCalledWith([
        expect.objectContaining({ contestId: '9', targetKey: 'ada', reason: 'day two' }),
      ]),
    );
  });
});

describe('contest task surface bulk detach', () => {
  it('drives the list and the selection from the filter, then detaches the filtered rows', async () => {
    const { container } = render(
      withDictionary(
        <ContestTasksSection
          contestId={7}
          tasks={[
            { id: 1, name: 'sum', title: 'Sum' },
            { id: 2, name: 'bob', title: 'Bob' },
          ]}
          expanded
          locale="en"
          permissionKeys={['task:update']}
          copy={en}
          onToggle={vi.fn()}
          onAddTask={vi.fn()}
          onAttachTasks={vi.fn()}
          onRemoveTask={vi.fn()}
          onRefresh={vi.fn()}
        />,
      ),
    );

    const filter = container.querySelector<HTMLInputElement>('#contest-task-filter');
    if (filter === null) throw new Error('the task filter is missing');
    fireEvent.change(filter, { target: { value: 'sum' } });

    const box = container.querySelector<HTMLInputElement>(`input[aria-label="${TASK_COPY.selectAll}"]`);
    if (box === null) throw new Error('the header select-all box is missing');
    fireEvent.click(box);

    const detach = buttonWithText(container, interpolate(TASK_COPY.detachSelected, { count: 1 }));
    if (detach === null) throw new Error('the detach button does not carry the filtered count');
    fireEvent.click(detach);

    await waitFor(() => expect(mocks.detachContestTasks).toHaveBeenCalledWith(7, [1]));
    await waitFor(() => expect(container.textContent).toContain(interpolate(TASK_COPY.detachDone, { count: 1 })));
  });

  it('refuses the whole batch with the named reason instead of skipping the off-contest row', async () => {
    mocks.detachContestTasks.mockResolvedValueOnce({
      success: false,
      changed: 0,
      error: 'task 2 is not on contest 7',
    });
    const { container } = render(
      withDictionary(
        <ContestTasksSection
          contestId={7}
          tasks={[{ id: 1, name: 'sum', title: 'Sum' }]}
          expanded
          locale="en"
          permissionKeys={['task:update']}
          copy={en}
          onToggle={vi.fn()}
          onAddTask={vi.fn()}
          onAttachTasks={vi.fn()}
          onRemoveTask={vi.fn()}
          onRefresh={vi.fn()}
        />,
      ),
    );

    const box = container.querySelector<HTMLInputElement>(`input[aria-label="${TASK_COPY.selectAll}"]`);
    if (box === null) throw new Error('the header select-all box is missing');
    fireEvent.click(box);

    const detach = buttonWithText(container, interpolate(TASK_COPY.detachSelected, { count: 1 }));
    if (detach === null) throw new Error('the detach button does not carry the filtered count');
    fireEvent.click(detach);

    await waitFor(() => expect(container.textContent).toContain('task 2 is not on contest 7'));
  });
});

describe('team membership day-two action', () => {
  it('rotates the usernames and sets the team for the whole filtered roster in one call', async () => {
    const { container } = render(
      withDictionary(
        <TeamMembersTab
          teamId={4}
          members={[
            { userId: 1, username: 'ada', firstName: 'Ada', lastName: 'Lovelace', contests: [] },
            { userId: 2, username: 'bob', firstName: 'Bob', lastName: 'Kane', contests: [] },
            { userId: null, username: null, firstName: null, lastName: null, contests: [] },
          ]}
          permissionKeys={['team:update', 'participation:update', 'username:set']}
          contests={[{ id: 9, name: 'Autumn' }]}
          navigation={en.navigation}
          copy={TEAM_COPY}
          locale="en"
        />,
      ),
    );

    const box = container.querySelector<HTMLInputElement>(
      `input[aria-label="${TEAM_COPY.members.selectAll}"]`,
    );
    if (box === null) throw new Error('the header select-all box is missing');
    fireEvent.click(box);

    const rotate = buttonWithText(container, TEAM_COPY.rotate.action);
    if (rotate === null) throw new Error('the rotate action is not on the selection toolbar');
    fireEvent.click(rotate);

    const contest = document.querySelector<HTMLSelectElement>('#team-rotate-contest');
    const reason = document.querySelector<HTMLInputElement>('#team-rotate-reason');
    if (contest === null || reason === null) throw new Error('the rotate dialog is missing its fields');
    fireEvent.change(contest, { target: { value: '9' } });
    fireEvent.change(reason, { target: { value: 'day two' } });

    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) throw new Error('the rotate dialog did not render');
    const run = buttonWithText(dialog, interpolate(TEAM_COPY.rotate.run, { count: 2 }));
    if (run === null) throw new Error('the rotate button does not carry the selected count');
    fireEvent.click(run);

    // Why the row with no user id is absent: the batch names accounts, and an unreadable id is
    // never guessed into the write.
    await waitFor(() => expect(mocks.rotateContestAccounts).toHaveBeenCalledWith(9, [1, 2], 4, 'day two'));
  });
});

describe('one write implementation per surface', () => {
  function filesUnder(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  }

  function sourceFilesUnder(directory: string): string[] {
    return filesUnder(directory).filter((file) => /\.(ts|tsx)$/.test(file));
  }

  function isInside(file: string, directory: string): boolean {
    const normalized = file.split(sep).join('/');
    return normalized.startsWith(`${directory}/`);
  }

  const WRITE_CALL = /ranking_overrides\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;

  it('keeps the only ranking-override write inside the shared panel-action module', () => {
    const offenders = sourceFilesUnder('src').filter(
      (file) => !isInside(file, 'src/lib/panel-actions') && WRITE_CALL.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('routes every bulk-capable panel surface through the shared module', () => {
    const consumers = [
      'src/app/actions/rankingOverrides.ts',
      'src/app/actions/contest-accounts.ts',
      'src/app/actions/contest-tasks.ts',
      'src/app/actions/team-members.ts',
      'src/lib/services/contests.ts',
      'src/app/api/contest-usernames/route.ts',
    ];
    for (const file of consumers) {
      expect(readFileSync(file, 'utf8'), file).toContain('@/lib/panel-actions');
    }
  });

  it('names every string the bulk surfaces render in both dictionaries', () => {
    const th = JSON.parse(readFileSync('src/dictionaries/th.json', 'utf8')) as Record<string, unknown>;
    const keys = [
      ['ranking', 'overrides', 'selectionCount'],
      ['ranking', 'overrides', 'endSelectedCount'],
      ['ranking', 'overrides', 'endedPartial'],
      ['ranking', 'overrides', 'addMany'],
      ['users', 'selectAllFiltered'],
      ['users', 'editSelectedCount'],
      ['teams', 'members', 'selectAll'],
      ['teams', 'rotate', 'action'],
      ['teams', 'rotate', 'run'],
      ['tasks', 'contestTasks', 'selectAll'],
      ['tasks', 'contestTasks', 'detachSelected'],
    ] as const;
    for (const path of keys) {
      let node: unknown = th;
      for (const segment of path) node = (node as Record<string, unknown>)[segment];
      expect(typeof node, path.join('.')).toBe('string');
    }
  });
});
