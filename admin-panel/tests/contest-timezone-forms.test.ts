// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

const { updateContestSettings, ensurePermission, queryRaw, findUnique, executeRawUnsafe } = vi.hoisted(() => ({
  updateContestSettings: vi.fn(),
  ensurePermission: vi.fn(),
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock('@/app/actions/contests', () => ({ updateContestSettings }));
vi.mock('@/lib/prisma', () => ({
  prisma: { participations: { findUnique }, contests: { findUnique }, $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission }));
vi.mock('@/lib/prisma-selects', () => ({ safeUserSelect: {} }));

import {
  buildPayload,
  collectZoneTimeErrors,
  defaultNewContestForm,
  emptyContestForm,
  formFromContest,
  formatDateForInput,
  rezoneTimeFields,
  toZoneInstants,
} from '@/components/contests/contest-modal/contestFormMappers';
import type { ContestFormData, ExistingContest } from '@/components/contests/contest-modal/types';
import { useContestForm } from '@/components/contests/contest-modal/useContestForm';
import { ContestStatusCard } from '@/components/contests/contest-detail/ContestStatusCard';
import { toOverviewFormState, toSettingsFormState, useContestSettingsState } from '@/components/contests/contest-detail/useContestSettingsState';
import { getParticipationDetails } from '@/app/actions/participation-reads';
import { executeParticipationUpdate } from '@/app/actions/participation-sql';
import { zoneDayRange, zoneWallClockToInstant } from '@/lib/timezone';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BANGKOK = 'Asia/Bangkok';
const TOKYO = 'Asia/Tokyo';
const KARACHI = 'Asia/Karachi';
const ROME = 'Europe/Rome';
const NEW_YORK = 'America/New_York';

function instantOf(wallClock: string, zone: string): string {
  const instant = zoneWallClockToInstant(wallClock, zone);
  if (instant === null) throw new Error(`expected ${wallClock} to name an instant in ${zone}`);
  return instant.toISOString();
}

function formWithTimes(patch: Partial<ContestFormData> = {}): ContestFormData {
  return {
    ...emptyContestForm(),
    name: 'Seven',
    start: '2026-12-31T15:00',
    stop: '2026-12-31T20:00',
    analysis_start: '2026-12-31T21:00',
    analysis_stop: '2026-12-31T22:00',
    ...patch,
  };
}

function existingContest(patch: Partial<ExistingContest> = {}): ExistingContest {
  const base: ExistingContest = {
    id: 7, name: 'Seven', description: 'Description',
    start: '2026-12-31T08:00:00.000Z', stop: '2026-12-31T13:00:00.000Z',
    timezone: BANGKOK, allowed_localizations: [], languages: ['cpp'],
    submissions_download_allowed: true, allow_questions: true, allow_user_tests: false,
    allow_unofficial_submission_before_analysis_mode: false, block_hidden_participations: false,
    allow_password_authentication: true, allow_registration: false, ip_restriction: false,
    ip_autologin: false, token_mode: 'disabled', token_max_number: null, token_min_interval: 60,
    token_gen_number: 0, token_gen_initial: 0, token_gen_interval: 30, token_gen_max: null, max_submission_number: 100,
    max_user_test_number: null, min_submission_interval: 60, min_user_test_interval: 60,
    queue_fairness_penalty_seconds: 0, score_precision: 2, analysis_enabled: true,
    analysis_start: '2026-12-31T14:00:00.000Z', analysis_stop: '2026-12-31T15:00:00.000Z',
  };
  // Why the assign form: spreading a Partial into the literal would relax every required key to
  // possibly-undefined, which the ExistingContest return type forbids.
  return Object.assign(base, patch);
}

describe('contest time inputs render in the contest zone', () => {
  it('renders an instant as a wall clock in the given zone', () => {
    expect(formatDateForInput(new Date('2026-12-31T08:00:00.000Z'), BANGKOK)).toBe('2026-12-31T15:00');
    expect(formatDateForInput('2026-12-31T14:00:00.000Z', ROME)).toBe('2026-12-31T15:00');
  });

  it('keeps a missing or unparsable value empty instead of NaN text', () => {
    expect(formatDateForInput(null, BANGKOK)).toBe('');
    expect(formatDateForInput('not-a-date', BANGKOK)).toBe('');
  });

  it('reads a stored contest in its own zone, never the browser zone', () => {
    const form = formFromContest(existingContest());
    expect(form.timezone).toBe(BANGKOK);
    expect([form.start, form.stop, form.analysis_start, form.analysis_stop]).toEqual([
      '2026-12-31T15:00', '2026-12-31T20:00', '2026-12-31T21:00', '2026-12-31T22:00',
    ]);
  });

  it('seeds a new contest in the default zone, where the window is anchored', () => {
    const form = defaultNewContestForm();
    const start = zoneWallClockToInstant(form.start, form.timezone);
    expect(start).not.toBeNull();
    expect((start as Date).getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect((start as Date).getTime()).toBeGreaterThan(Date.now() - 61_000);
  });

  it('renders the overview and settings payloads in the contest zone', () => {
    const overview = toOverviewFormState({
      id: 7, name: 'Seven', description: 'Description', is_active: true,
      start: '2026-12-31T08:00:00.000Z', stop: null, analysis_start: null, analysis_stop: null,
      timezone: BANGKOK, permissionKeys: [],
    });
    expect(overview.timezone).toBe(BANGKOK);
    expect(overview.start).toBe('2026-12-31T15:00');
    expect(overview.stop).toBe('');

    const settings = toSettingsFormState({
      name: 'Seven', description: 'Description', timezone: ROME, allow_questions: true,
      allow_user_tests: false, submissions_download_allowed: true, allow_password_authentication: true,
      allow_registration: false, analysis_enabled: false, token_mode: 'disabled', score_precision: 2,
      start: '2026-12-31T14:00:00.000Z', stop: '2026-12-31T15:00:00.000Z',
      analysis_start: null, analysis_stop: null,
    });
    expect(settings.start).toBe('2026-12-31T15:00');
    expect(settings.stop).toBe('2026-12-31T16:00');
  });
});

describe('contest payloads store the instant the wall clock names', () => {
  it('converts the four fields for a zone without DST', () => {
    const payload = buildPayload(formWithTimes({ timezone: BANGKOK }));
    expect(payload.start).toEqual(new Date('2026-12-31T08:00:00.000Z'));
    expect(payload.analysis_stop).toEqual(new Date('2026-12-31T15:00:00.000Z'));
  });

  it('applies the summer offset of a zone that observes DST', () => {
    const payload = buildPayload(formWithTimes({
      timezone: ROME, start: '2026-07-04T12:00', stop: '2026-07-04T17:00',
      analysis_start: '', analysis_stop: '',
    }));
    expect(payload.start).toEqual(new Date('2026-07-04T10:00:00.000Z'));
    expect(payload.stop).toEqual(new Date('2026-07-04T15:00:00.000Z'));
  });

  it('leaves a cleared field empty rather than inventing an epoch', () => {
    const payload = toZoneInstants({ start: '2026-12-31T15:00', stop: '' }, BANGKOK);
    expect(payload.start).toEqual(new Date('2026-12-31T08:00:00.000Z'));
    expect(payload.stop).toBe('');
  });
});

describe('contest wall clocks that name no single instant', () => {
  it('reports a spring-forward gap on the field that carries it', () => {
    const errors = collectZoneTimeErrors(formWithTimes({ timezone: NEW_YORK, start: '2026-03-08T02:30' }), NEW_YORK);
    expect([...errors.keys()]).toEqual(['start']);
    expect(errors.get('start')).toContain('02:30 does not exist in America/New_York');
    expect(errors.get('start')).toContain('02:00 → 03:00');
  });

  it('reports a fall-back repeat and names both instants', () => {
    const errors = collectZoneTimeErrors(formWithTimes({ timezone: NEW_YORK, stop: '2026-11-01T01:30' }), NEW_YORK);
    expect([...errors.keys()]).toEqual(['stop']);
    expect(errors.get('stop')).toContain('05:30Z or 06:30Z');
  });

  it('passes a form whose wall clocks all name one instant', () => {
    expect(collectZoneTimeErrors(formWithTimes({ timezone: BANGKOK }), BANGKOK).size).toBe(0);
  });
});

describe('changing the timezone moves the wall clock, not the instant', () => {
  it('shifts the wall clock forward into an eastern zone', () => {
    const bangkok = formWithTimes({ timezone: BANGKOK, start: '2026-12-31T15:00' });
    const moved = rezoneTimeFields(bangkok, { ...bangkok, timezone: TOKYO });
    // Tokyo is two hours east of Bangkok (+09 vs +07), so the same instant reads two hours later.
    expect(moved.start).toBe('2026-12-31T17:00');
    expect(instantOf(moved.start, TOKYO)).toBe(instantOf(bangkok.start, BANGKOK));
  });

  it('shifts the wall clock back into a zone behind the current one', () => {
    const bangkok = formWithTimes({ timezone: BANGKOK, start: '2026-12-31T15:00' });
    const moved = rezoneTimeFields(bangkok, { ...bangkok, timezone: KARACHI });
    expect(moved.start).toBe('2026-12-31T13:00');
    expect(instantOf(moved.start, KARACHI)).toBe(instantOf(bangkok.start, BANGKOK));
  });

  it('leaves the wall clocks alone when the zone does not change', () => {
    const form = formWithTimes({ timezone: BANGKOK });
    const renamed = { ...form, name: 'Renamed' };
    expect(rezoneTimeFields(form, renamed)).toEqual(renamed);
  });
});

function SettingsHarness({ initial, seed }: { initial: ReturnType<typeof toOverviewFormState>; seed?: Partial<ReturnType<typeof toOverviewFormState>> }) {
  const { formData, updateForm, handleSave, timeErrors } = useContestSettingsState(7, initial, (form) => ({
    start: form.start, stop: form.stop, analysis_start: form.analysis_start, analysis_stop: form.analysis_stop,
  }));
  return createElement('div', null,
    createElement('output', { 'data-testid': 'zone' }, formData.timezone),
    createElement('output', { 'data-testid': 'start' }, formData.start),
    createElement('output', { 'data-testid': 'start-error' }, timeErrors.start ?? ''),
    createElement('output', { 'data-testid': 'stop-error' }, timeErrors.stop ?? ''),
    seed
      ? createElement('button', { type: 'button', onClick: () => updateForm(seed) }, 'seed')
      : null,
    createElement('button', { type: 'button', onClick: () => updateForm({ timezone: TOKYO }) }, 'rezone'),
    createElement('button', { type: 'button', onClick: () => { void handleSave(); } }, 'save'),
  );
}

function overviewForm(timezone: string, start: string): ReturnType<typeof toOverviewFormState> {
  return toOverviewFormState({
    id: 7, name: 'Seven', description: 'Description', is_active: true,
    start: start, stop: '2026-12-31T13:00:00.000Z', analysis_start: null, analysis_stop: null,
    timezone, permissionKeys: [],
  });
}

describe('the contest status card save', () => {
  it('sends the instant the Bangkok wall clock names', async () => {
    updateContestSettings.mockResolvedValue({ success: true });
    render(createElement(SettingsHarness, { initial: overviewForm(BANGKOK, '2026-12-31T08:00:00.000Z') }));

    await act(async () => { screen.getByRole('button', { name: 'save' }).click(); });

    expect(screen.getByTestId('start').textContent).toBe('2026-12-31T15:00');
    expect(updateContestSettings).toHaveBeenCalledWith(7, expect.objectContaining({
      start: new Date('2026-12-31T08:00:00.000Z'),
      stop: new Date('2026-12-31T13:00:00.000Z'),
    }));
  });

  it('re-renders the wall clock when the timezone field changes', async () => {
    render(createElement(SettingsHarness, { initial: overviewForm(BANGKOK, '2026-12-31T08:00:00.000Z') }));
    expect(screen.getByTestId('start').textContent).toBe('2026-12-31T15:00');

    await act(async () => { screen.getByRole('button', { name: 'rezone' }).click(); });

    expect(screen.getByTestId('zone').textContent).toBe(TOKYO);
    expect(screen.getByTestId('start').textContent).toBe('2026-12-31T17:00');
  });

  it('aborts the save on a spring-forward gap and names the field', async () => {
    render(createElement(SettingsHarness, {
      initial: overviewForm(NEW_YORK, '2026-03-08T00:00:00.000Z'),
      seed: { start: '2026-03-08T02:30' },
    }));

    await act(async () => { screen.getByRole('button', { name: 'seed' }).click(); });
    await act(async () => { screen.getByRole('button', { name: 'save' }).click(); });

    expect(updateContestSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('start-error').textContent).toContain('02:00 → 03:00');
  });

  it('aborts the save on a fall-back repeat and names both instants', async () => {
    render(createElement(SettingsHarness, {
      initial: overviewForm(NEW_YORK, '2026-11-01T00:00:00.000Z'),
      seed: { stop: '2026-11-01T01:30' },
    }));

    await act(async () => { screen.getByRole('button', { name: 'seed' }).click(); });
    await act(async () => { screen.getByRole('button', { name: 'save' }).click(); });

    expect(updateContestSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('stop-error').textContent).toContain('05:30Z or 06:30Z');
  });

  it('shows the zone error under the input it belongs to', () => {
    const message = '02:30 does not exist in America/New_York on 2026-03-08 (DST begins, clocks jump 02:00 → 03:00)';
    render(createElement(ContestStatusCard, {
      contest: { start: null, stop: null, analysis_start: null, analysis_stop: null },
      formData: { start: '2026-03-08T02:30', stop: '', analysis_start: '', analysis_stop: '' },
      onChange: () => undefined,
      timeErrors: { start: message },
    }));
    expect(screen.getByText(message)).not.toBeNull();
  });
});

function ContestFormHarness({ contest }: { contest: ExistingContest }) {
  const { formData, setFormData } = useContestForm(true, contest);
  return createElement('div', null,
    createElement('output', { 'data-testid': 'modal-start' }, formData.start),
    createElement('output', { 'data-testid': 'modal-analysis-start' }, formData.analysis_start),
    createElement('output', { 'data-testid': 'modal-analysis-stop' }, formData.analysis_stop),
    createElement('button', { type: 'button', onClick: () => setFormData((prev) => ({ ...prev, timezone: TOKYO })) }, 'rezone'),
  );
}

describe('the contest modal auto analysis window', () => {
  it('derives it from the stop instant in the form zone', () => {
    render(createElement(ContestFormHarness, { contest: existingContest({ timezone: ROME, stop: '2026-12-31T14:30:00.000Z' }) }));
    // The window is minute-truncated for a datetime-local input, so its start lands on the
    // stop minute while its end keeps the full hour.
    expect(screen.getByTestId('modal-analysis-start').textContent).toBe('2026-12-31T15:30');
    expect(screen.getByTestId('modal-analysis-stop').textContent).toBe('2026-12-31T16:30');
  });

  it('renders the same instants in a zone without DST', () => {
    render(createElement(ContestFormHarness, { contest: existingContest({ timezone: BANGKOK, stop: '2026-12-31T14:30:00.000Z' }) }));
    expect(screen.getByTestId('modal-analysis-start').textContent).toBe('2026-12-31T21:30');
    expect(screen.getByTestId('modal-analysis-stop').textContent).toBe('2026-12-31T22:30');
  });

  it('re-projects the modal fields when the timezone field changes', async () => {
    render(createElement(ContestFormHarness, { contest: existingContest({ timezone: ROME, start: '2026-12-31T13:00:00.000Z' }) }));
    expect(screen.getByTestId('modal-start').textContent).toBe('2026-12-31T14:00');

    await act(async () => { screen.getByRole('button', { name: 'rezone' }).click(); });

    expect(screen.getByTestId('modal-start').textContent).toBe('2026-12-31T22:00');
  });
});

describe('participation starting time boundaries', () => {
  it('reads the stored instant in the contest zone of its participation', async () => {
    queryRaw.mockResolvedValue([{
      id: 5, contest_id: 7, user_id: 3, team_id: null, hidden: false, unrestricted: false,
      delay_time_seconds: 0, extra_time_seconds: 0, starting_time: new Date('2026-12-31T08:00:00.000Z'),
      ip_string: null, timezone: BANGKOK,
    }]);

    const details = await getParticipationDetails(5);

    expect(details?.starting_time).toBe('2026-12-31T15:00');
  });

  it('writes the instant the contest-zone wall clock names', async () => {
    findUnique.mockResolvedValue({ contests: { timezone: BANGKOK } });

    await executeParticipationUpdate(5, { starting_time: '2026-12-31T15:00' }, []);

    const params = executeRawUnsafe.mock.calls[0].slice(1) as unknown[];
    expect(params[6]).toEqual(new Date('2026-12-31T08:00:00.000Z'));
  });

  it('refuses to write a wall clock that names no instant in the contest zone', async () => {
    findUnique.mockResolvedValue({ contests: { timezone: NEW_YORK } });

    await expect(executeParticipationUpdate(5, { starting_time: '2026-03-08T02:30' }, []))
      .rejects.toThrow(/02:30 does not exist in America\/New_York/);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('audit day filters read in the reader zone', () => {
  it('spans a whole day, start through its last millisecond', () => {
    const range = zoneDayRange('2026-03-08', '2026-03-08', NEW_YORK);
    expect(range.gte?.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    // That day is 23 hours long: 23:59:59.999 EDT is 03:59:59.999Z the next day, not 04:59.
    expect(range.lte?.toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('narrows to the bound a half-filled filter carries', () => {
    const range = zoneDayRange('2026-12-31', '', BANGKOK);
    expect(range.gte?.toISOString()).toBe('2026-12-30T17:00:00.000Z');
    expect(range.lte).toBeNull();
  });
});
