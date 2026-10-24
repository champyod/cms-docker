import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  overrides: vi.fn(),
  hidden: vi.fn(),
  users: vi.fn(),
  teams: vi.fn(),
  tasks: vi.fn(),
  contests: vi.fn(),
  admins: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_overrides: { findMany: mocks.overrides },
    ranking_hidden: { findMany: mocks.hidden },
    ranking_users: { findMany: mocks.users },
    ranking_teams: { findMany: mocks.teams },
    ranking_tasks: { findMany: mocks.tasks },
    ranking_contests: { findMany: mocks.contests },
    admins: { findMany: mocks.admins },
  },
}));

import { describeHides, readBoardHides, type HideOverrideRow, type HideProjection } from '@/lib/ranking-hides';

function hide(overrides: Partial<HideOverrideRow>): HideOverrideRow {
  return {
    targetKind: 'user',
    targetKey: 'ada',
    reason: 'test account',
    createdBy: 3,
    createdByName: 'root',
    ...overrides,
  };
}

const EMPTY_PROJECTION: HideProjection = {
  users: new Map(),
  teams: new Map(),
  tasks: new Map(),
  contests: new Map(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.overrides.mockResolvedValue([]);
  mocks.hidden.mockResolvedValue([]);
  mocks.users.mockResolvedValue([]);
  mocks.teams.mockResolvedValue([]);
  mocks.tasks.mockResolvedValue([]);
  mocks.contests.mockResolvedValue([]);
  mocks.admins.mockResolvedValue([]);
});

describe('describeHides', () => {
  it('names the target the projection holds instead of the key the row carries', () => {
    // The projection keys a row with ProxyService's encoded spelling; the panel writes what the
    // operator saw. One hide, two spellings, and the label has to be the board's name.
    const projection: HideProjection = {
      ...EMPTY_PROJECTION,
      users: new Map([['anna_2dmarie', 'Anna-Marie']]),
    };

    const [only] = describeHides([hide({ targetKey: 'anna-marie' })], [], projection);

    expect(only.label).toBe('Anna-Marie');
    expect(only.targetKind).toBe('user');
  });

  it('marks a hide that names nothing the board has', () => {
    const [only] = describeHides([hide({ targetKey: 'ghost' })], [], EMPTY_PROJECTION);

    expect(only.label).toBeNull();
    expect(only.targetKey).toBe('ghost');
  });

  it('reports a hidden participation the override table never recorded', () => {
    const projection: HideProjection = {
      ...EMPTY_PROJECTION,
      users: new Map([['bob', 'Bob Stone']]),
    };

    const [only] = describeHides([], ['bob'], projection);

    expect(only.targetKind).toBe('user');
    expect(only.label).toBe('Bob Stone');
    expect(only.sources).toEqual([{ source: 'participation' }]);
  });

  it('merges a tombstone and an override that hide the same row', () => {
    const projection: HideProjection = {
      ...EMPTY_PROJECTION,
      users: new Map([['ada', 'Ada Lovelace']]),
    };

    const hides = describeHides([hide({ targetKey: 'ada' })], ['ada'], projection);

    expect(hides).toHaveLength(1);
    expect(hides[0].sources).toHaveLength(2);
    expect(hides[0].sources.map((source) => source.source)).toEqual(['override', 'participation']);
  });

  it('keeps the author of the row, so an unattributed hide reads as one', () => {
    const [attributed] = describeHides([hide({ createdBy: 7, createdByName: 'operator' })], [], EMPTY_PROJECTION);
    const [unattributed] = describeHides([hide({ createdBy: null, createdByName: null })], [], EMPTY_PROJECTION);

    expect(attributed.sources[0]).toMatchObject({ source: 'override', createdBy: 7, createdByName: 'operator' });
    expect(unattributed.sources[0]).toMatchObject({ source: 'override', createdBy: null });
  });

  it('resolves a task hide through the composite key the form writes', () => {
    const projection: HideProjection = {
      ...EMPTY_PROJECTION,
      tasks: new Map([['aplusb', 'A plus B']]),
    };

    const [only] = describeHides([hide({ targetKind: 'task', targetKey: 'spring/aplusb' })], [], projection);

    expect(only.label).toBe('A plus B');
  });

  it('leaves the whole-board hide unresolved, because it names no row', () => {
    const [only] = describeHides(
      [hide({ targetKind: 'ranking', targetKey: '*' })],
      [],
      { ...EMPTY_PROJECTION, contests: new Map([['spring', 'Spring']]) },
    );

    expect(only.targetKey).toBe('*');
    expect(only.label).toBeNull();
  });

  it('lists hides in a stable order so two reads of one board agree', () => {
    const hides = describeHides(
      [hide({ targetKey: 'zoe' }), hide({ targetKind: 'team', targetKey: 'alpha' }), hide({ targetKey: 'ada' })],
      [],
      EMPTY_PROJECTION,
    );

    expect(hides.map((row) => `${row.targetKind}:${row.targetKey}`)).toEqual([
      'team:alpha',
      'user:ada',
      'user:zoe',
    ]);
  });
});

describe('readBoardHides', () => {
  it('scopes both writers to the shard contest', async () => {
    await readBoardHides(9);

    expect(mocks.overrides).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'hide', active: true, contest_id: 9 } }),
    );
    expect(mocks.hidden).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contest_id: 9 } }),
    );
  });

  it('reads the task column inside the same contest', async () => {
    mocks.overrides.mockResolvedValue([
      { target_kind: 'task', target_key: 'spring/aplusb', reason: 'withdrawn', created_by: 7 },
    ]);
    mocks.admins.mockResolvedValue([{ id: 7, username: 'operator' }]);
    mocks.tasks.mockResolvedValue([{ key: 'aplusb', name: 'A plus B' }]);

    const [only] = await readBoardHides(9);

    expect(mocks.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contest_id: 9, key: { in: expect.arrayContaining(['aplusb']) } } }),
    );
    expect(only.label).toBe('A plus B');
    expect(only.sources[0]).toMatchObject({ source: 'override', createdByName: 'operator' });
  });

  it('names a participation tombstone from the projection it hides', async () => {
    mocks.hidden.mockResolvedValue([{ key: 'ada' }]);
    mocks.users.mockResolvedValue([{ key: 'ada', f_name: 'Ada', l_name: 'Lovelace' }]);

    const [only] = await readBoardHides(9);

    expect(only.label).toBe('Ada Lovelace');
    expect(only.sources).toEqual([{ source: 'participation' }]);
  });

  it('asks the projection nothing when the board hides nothing', async () => {
    await readBoardHides(9);

    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.teams).not.toHaveBeenCalled();
    expect(mocks.tasks).not.toHaveBeenCalled();
    expect(mocks.contests).not.toHaveBeenCalled();
  });
});
