import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { Prisma } from '@prisma/client';

import { getRankingAppearance, saveRankingAppearance, updateRankingAppearance } from '@/app/actions/rankingAppearance';
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

describe('saving a partial appearance', () => {
  // The System page's *Save Access Mode* button posts the access mode, the words it re-states and
  // the text it owns. It never posts the theme, the score format or the perspective config, which
  // are the appearance page's to edit — so those columns must keep whatever is stored for them.
  const ACCESS_MODE_POST = {
    title: 'Day Two',
    subtitle: 'Round two',
    organisation: 'POSN',
    displayName: 'Oct 2026',
    accessMode: 'protected',
    footerText: 'thanks',
    creditsText: 'courtesy of the organisers',
  };

  function formDataOf(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) formData.append(name, value);
    return formData;
  }

  it('writes the fields the caller stated and leaves the columns it did not mention alone', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    const result = await saveRankingAppearance(formDataOf(ACCESS_MODE_POST));

    expect(result.success).toBe(true);
    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update.access_mode).toBe('protected');
    expect(written.update.wording_overrides).toEqual({
      '9': { title: 'Day Two', subtitle: 'Round two' },
    });
    // WHY the assertion is on the key's absence rather than on its value: the defect was that
    // these columns were written at all — a field absent from the post was read as an emptied
    // box and stored as JSON null, clearing the stored config on every access-mode save.
    expect(written.update).not.toHaveProperty('theme');
    expect(written.update).not.toHaveProperty('score_format');
    expect(written.update).not.toHaveProperty('perspectives');
  });

  it('still clears a column the caller posts empty', async () => {
    mocks.configFindMany.mockResolvedValue([{ target_kind: 'contest', target_key: '9' }]);

    // An emptied box is an instruction to clear the column; only leaving the field out of the
    // post is the "leave it alone" this write now reads it as.
    await saveRankingAppearance(formDataOf({ theme: '' }));

    const written = mocks.settingsUpsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(written.update).toHaveProperty('theme');
    expect(written.update.theme).toBe(Prisma.JsonNull);
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
