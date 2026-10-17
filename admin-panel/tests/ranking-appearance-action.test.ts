import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// WHY the prisma mock: what these assert is that the appearance write carries no contest column
// and that the wording is keyed by the contest the config shows — a contract with the reader, not
// a database round trip.
const mocks = vi.hoisted(() => ({
  settingsFindUnique: vi.fn(),
  settingsUpsert: vi.fn(),
  configFindMany: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_settings: { findUnique: mocks.settingsFindUnique, upsert: mocks.settingsUpsert },
    ranking_config: { findMany: mocks.configFindMany },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  getRankingAppearance,
  updateRankingAppearance,
  type AppearanceFields,
} from '@/app/actions/rankingAppearance';
import { readShownContestId } from '@/lib/ranking-shown';

function settingsRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: null,
    subtitle: null,
    organisation: null,
    wording_overrides: null,
    display_name: null,
    logo_asset: null,
    favicon_asset: null,
    theme: null,
    columns: null,
    score_format: null,
    footer_text: null,
    credits_text: null,
    credits: null,
    perspectives: null,
    access_mode: 'public',
    updated_at: new Date('2026-10-16T00:00:00Z'),
    updated_by: null,
    ...overrides,
  };
}

const FIELDS = {
  title: '',
  subtitle: '',
  organisation: 'POSN',
  displayName: '',
  accessMode: 'public' as const,
  showIdColumn: false,
  anonymous: false,
  footerText: '',
  creditsText: '',
  theme: '',
  scoreFormat: '',
  perspectives: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsUpsert.mockImplementation(async (_args: unknown) => settingsRow());
  mocks.ensurePermission.mockResolvedValue(undefined);
});

describe('the shown contest the appearance words follow', () => {
  it('answers the one active target the config names', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    expect(await readShownContestId()).toBe(9);
  });

  it('answers none when the board shows nothing, and none when it shows several', async () => {
    mocks.configFindMany.mockResolvedValue([]);
    expect(await readShownContestId()).toBeNull();

    mocks.configFindMany.mockResolvedValue([
      { target_kind: 'contest', target_key: '9' },
      { target_kind: 'contest', target_key: '3' },
    ]);
    expect(await readShownContestId()).toBeNull();
  });

  it('refuses a declaration the reader could not draw rather than answering none', async () => {
    // The board refuses an unknown target kind and a key that is not an id at every route, so the
    // panel refuses them too: answering "no contest" here would let the two halves of one config
    // disagree, and would hide a typo behind a board that looks deliberately empty.
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'task', target_key: '9' }]);
    await expect(readShownContestId()).rejects.toThrow(/cannot draw/);

    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: 'day-two' }]);
    await expect(readShownContestId()).rejects.toThrow(/not a contest id/);
  });
});

describe('saving the appearance', () => {
  it('writes no contest column and keys the words by the shown contest', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    await updateRankingAppearance({ ...FIELDS, title: 'Day Two', subtitle: 'Round two' });

    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update).not.toHaveProperty('contest_id');
    expect(written.update.wording_overrides).toEqual({
      '9': { title: 'Day Two', subtitle: 'Round two' },
    });
  });

  it('still saves the fields the page keeps editing', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    const result = await updateRankingAppearance({
      ...FIELDS,
      organisation: 'POSN Thailand',
      theme: '{"accent":"#00A3DA"}',
      footerText: 'thanks',
    });

    expect(result.success).toBe(true);
    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update.organisation).toBe('POSN Thailand');
    expect(written.update.theme).toEqual({ accent: '#00A3DA' });
    expect(written.update.footer_text).toBe('thanks');
  });

  it('refuses header words when the config shows no single contest', async () => {
    mocks.configFindMany.mockResolvedValue([]);

    const result = await updateRankingAppearance({ ...FIELDS, title: 'Day Two' });

    expect(result.success).toBe(false);
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
  });
});

describe('reading the appearance', () => {
  it('reads the words written for the contest the config shows', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);
    mocks.settingsFindUnique.mockResolvedValue(
      settingsRow({ wording_overrides: { '9': { title: 'Day Two', subtitle: 'Round two' } } }),
    );

    const appearance = await getRankingAppearance();

    expect(appearance.title).toBe('Day Two');
    expect(appearance.subtitle).toBe('Round two');
  });

  it('reads no header words when the board shows nothing', async () => {
    mocks.configFindMany.mockResolvedValue([]);
    mocks.settingsFindUnique.mockResolvedValue(
      settingsRow({ wording_overrides: { '9': { title: 'Day Two', subtitle: 'Round two' } } }),
    );

    const appearance = await getRankingAppearance();

    expect(appearance.title).toBe('');
    expect(appearance.subtitle).toBe('');
  });
});

describe('saving a partial appearance', () => {
  // WHY the assertion is on a key's absence rather than on its value: the defect was that these
  // columns were written at all — a field the caller never stated was built as an emptied box and
  // stored as JSON null, so a save that owned one setting cleared the stored theme, score format
  // and perspective config. The System page's own *Save Access Mode* button was that caller, and
  // this is the proof the write stayed partial after that entry point was removed.
  it('writes the fields the caller stated and leaves the columns it did not mention alone', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    await updateRankingAppearance({ accessMode: 'protected' } as AppearanceFields);

    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update.access_mode).toBe('protected');
    expect(written.update).not.toHaveProperty('theme');
    expect(written.update).not.toHaveProperty('score_format');
    expect(written.update).not.toHaveProperty('perspectives');
  });

  it('still clears a column the caller states empty', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    // An emptied box is an instruction to clear the column; only leaving the field out of the
    // statement is the "leave it alone" this write reads it as.
    await updateRankingAppearance({ theme: '' } as AppearanceFields);

    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update).toHaveProperty('theme');
    expect(written.update.theme).toBe(Prisma.JsonNull);
  });
});
