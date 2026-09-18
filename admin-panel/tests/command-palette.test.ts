import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PALETTE_NAV_ITEMS,
  buildNavVisibility,
  filterNavItems,
  filterTeams,
  isNumericQuery,
} from '@/components/palette/palette-data';
import { createSearchScheduler } from '@/components/palette/search-scheduler';

const ALL_PERMISSIONS: readonly string[] = ['all:all'];

const CONTEST_PERMISSIONS: readonly string[] = ['contest:list', 'submission:list'];

const USER_PERMISSIONS: readonly string[] = ['user:list', 'team:list'];

function labelsFor(permissionKeys: readonly string[]): string[] {
  return filterNavItems(new Set(permissionKeys)).map((item) => item.label);
}

describe('buildNavVisibility', () => {
  it('returns closed visibility for missing permissions', () => {
    expect(buildNavVisibility([])).toEqual({
      contests: false,
      tasks: false,
      users: false,
    });
  });

  it('grants full visibility through the superadmin bypass', () => {
    const visibility = buildNavVisibility(ALL_PERMISSIONS);
    expect(visibility).toEqual({ contests: true, tasks: true, users: true });
  });

  it('maps granular permissions without the superadmin bypass', () => {
    expect(buildNavVisibility(CONTEST_PERMISSIONS)).toEqual({
      contests: true,
      tasks: false,
      users: false,
    });
  });
});

describe('filterNavItems', () => {
  it('shows general items only when nothing is permitted', () => {
    expect(labelsFor([])).toEqual(['Dashboard', 'Documentation', 'Search']);
  });

  it('shows contest-scoped items for contest permission only', () => {
    const labels = labelsFor(CONTEST_PERMISSIONS);
    expect(labels).toEqual(expect.arrayContaining(['Dashboard', 'Documentation', 'Contests', 'Submissions']));
    expect(labels).not.toContain('Tasks');
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Teams');
    expect(labels).not.toContain('Permissions');
  });

  it('shows user-scoped items for user permission', () => {
    const labels = labelsFor(USER_PERMISSIONS);
    expect(labels).toEqual(expect.arrayContaining(['Users', 'Teams']));
    expect(labels).not.toContain('Contests');
  });

  it('shows every item for superadmin', () => {
    expect(labelsFor(ALL_PERMISSIONS)).toHaveLength(PALETTE_NAV_ITEMS.length);
  });

  it('shows the merged Permissions entry for either of its list keys', () => {
    expect(labelsFor(['admin:list'])).toContain('Permissions');
    expect(labelsFor(['group:list'])).toContain('Permissions');
  });

  it('hides the merged Permissions entry without either list key', () => {
    expect(labelsFor(['audit:read', 'appearance:list'])).not.toContain('Permissions');
  });
});

describe('isNumericQuery', () => {
  it('accepts digit-only queries including surrounding whitespace', () => {
    expect(isNumericQuery('123')).toBe(true);
    expect(isNumericQuery(' 42 ')).toBe(true);
  });

  it('rejects mixed or empty queries', () => {
    expect(isNumericQuery('12a')).toBe(false);
    expect(isNumericQuery('')).toBe(false);
    expect(isNumericQuery('task')).toBe(false);
  });
});

describe('filterTeams', () => {
  const teams = [
    { id: 1, code: 'THA01', name: 'Bangkok Bears' },
    { id: 2, code: 'SGP02', name: 'Singapore Sharks' },
  ];

  it('matches team names case-insensitively', () => {
    expect(filterTeams(teams, 'bears')).toEqual([teams[0]]);
  });

  it('matches team codes case-insensitively', () => {
    expect(filterTeams(teams, 'sgp')).toEqual([teams[1]]);
  });

  it('returns nothing for blank or unmatched queries', () => {
    expect(filterTeams(teams, '')).toEqual([]);
    expect(filterTeams(teams, '   ')).toEqual([]);
    expect(filterTeams(teams, 'tokyo')).toEqual([]);
  });
});

describe('createSearchScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the scheduled search exactly once after the debounce delay', () => {
    const scheduler = createSearchScheduler(250);
    const run = vi.fn<(signal: AbortSignal) => void>();

    scheduler.schedule(run);
    vi.advanceTimersByTime(249);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].aborted).toBe(false);
  });

  it('drops a pending search when a newer one is scheduled', () => {
    const scheduler = createSearchScheduler(250);
    const firstRun = vi.fn<(signal: AbortSignal) => void>();
    const secondRun = vi.fn<(signal: AbortSignal) => void>();

    scheduler.schedule(firstRun);
    vi.advanceTimersByTime(100);
    scheduler.schedule(secondRun);

    vi.advanceTimersByTime(250);
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('aborts the previous signal once a newer search supersedes it', () => {
    const scheduler = createSearchScheduler(250);
    const firstRun = vi.fn<(signal: AbortSignal) => void>();

    scheduler.schedule(firstRun);
    vi.advanceTimersByTime(250);
    scheduler.schedule(vi.fn<(signal: AbortSignal) => void>());

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(firstRun.mock.calls[0][0].aborted).toBe(true);
  });

  it('cancel prevents the run and clears the pending timer', () => {
    const scheduler = createSearchScheduler(250);
    const run = vi.fn<(signal: AbortSignal) => void>();

    scheduler.schedule(run);
    scheduler.cancel();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });
});
