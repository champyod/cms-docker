import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { parseInterval } from '@/lib/contest-validation';
import type { ContestData } from '@/lib/contest-validation';
import { normalizeLimitValue } from '@/lib/limits';
import {
  AmbiguousZoneTimeError,
  NonexistentZoneTimeError,
  utcToZoneWallClock,
  zoneWallClockToInstant,
} from '@/lib/timezone';
import type { ContestFormData, ExistingContest } from './types';

/** The four wall clocks a contest form owns, and the only keys a zone can invalidate. */
export const CONTEST_TIME_FIELDS = ['start', 'stop', 'analysis_start', 'analysis_stop'] as const;

export type ContestTimeField = (typeof CONTEST_TIME_FIELDS)[number];

/** The shape every zone-aware contest form shares, whichever tab or modal owns it. */
export interface ContestTimeFields {
  timezone: string;
  start: string;
  stop: string;
  analysis_start: string;
  analysis_stop: string;
}

/**
 * Render a stored instant as the `datetime-local` value an operator reads it in. `zone` is the
 * form's own live zone, so a picker always shows the wall clock that zone names.
 */
export function formatDateForInput(date: Date | string | null | undefined, zone?: string): string {
  if (!date) return '';
  const iso = date instanceof Date ? date.toISOString() : date;
  if (Number.isNaN(new Date(iso).getTime())) return '';
  return utcToZoneWallClock(iso, zone ?? '');
}

/** Null when the wall clock names an instant; the thrown zone error's message when it names none. */
function zoneTimeError(value: string, zone: string): string | null {
  try {
    zoneWallClockToInstant(value, zone);
    return null;
  } catch (error) {
    if (error instanceof NonexistentZoneTimeError || error instanceof AmbiguousZoneTimeError) return error.message;
    throw error;
  }
}

/**
 * Why: a wall clock inside a DST gap or a fall-back repeat names no single instant, so the save
 * must stop at the field instead of storing a shifted time. Each message is the thrown error
 * verbatim — it names the zone, the jump, or both candidate instants.
 */
export function collectZoneTimeErrors(form: ContestTimeFields, zone: string): Map<string, string> {
  const errors = new Map<string, string>();
  for (const field of CONTEST_TIME_FIELDS) {
    const message = zoneTimeError(form[field], zone);
    if (message !== null) errors.set(field, message);
  }
  return errors;
}

/** Why: an unresolvable wall clock has no instant to move, so the typed value stays for the submit error. */
function reprojectInstant(value: string, fromZone: string, toZone: string): string {
  if (zoneTimeError(value, fromZone) !== null) return value;
  const instant = zoneWallClockToInstant(value, fromZone);
  return instant === null ? value : utcToZoneWallClock(instant.toISOString(), toZone);
}

/**
 * Why: the pickers follow the form's live timezone field, so a zone change must move the four wall
 * clocks to the same instants in the new zone — never re-read the old digits as a new wall clock.
 */
export function rezoneTimeFields<T extends ContestTimeFields>(previous: T, next: T): T {
  if (next.timezone === previous.timezone) return next;
  return {
    ...next,
    start: reprojectInstant(previous.start, previous.timezone, next.timezone),
    stop: reprojectInstant(previous.stop, previous.timezone, next.timezone),
    analysis_start: reprojectInstant(previous.analysis_start, previous.timezone, next.timezone),
    analysis_stop: reprojectInstant(previous.analysis_stop, previous.timezone, next.timezone),
  };
}

/**
 * Why: tabs and the modal build their payload from wall-clock strings; converting once here means
 * every contest write stores the instant the form's zone names, with no per-call-site conversion
 * to forget. A cleared field stays empty so the writer keeps its unchanged-value path. The
 * payload's own type is preserved, so the strict repo contract and the validation contract each
 * keep the shape they were written against.
 */
export function toZoneInstants<T extends Partial<Record<ContestTimeField, string | Date | null | undefined>>>(
  payload: T,
  zone: string,
): T {
  const converted = { ...payload };
  for (const field of CONTEST_TIME_FIELDS) {
    const value = converted[field];
    if (typeof value !== 'string' || value === '') continue;
    converted[field] = zoneWallClockToInstant(value, zone) ?? value;
  }
  return converted;
}

type CommonFormFields = Omit<
  ContestFormData,
  | 'name'
  | 'description'
  | 'start'
  | 'stop'
  | 'languages'
  | 'max_submission_number'
  | 'min_submission_interval'
  | 'min_user_test_interval'
  | 'score_precision'
  | 'analysis_start'
  | 'analysis_stop'
>;

const COMMON_DEFAULTS: CommonFormFields = {
  timezone: 'Asia/Bangkok',
  allowed_localizations: '',
  submissions_download_allowed: true,
  allow_questions: true,
  allow_user_tests: false,
  allow_unofficial_submission_before_analysis_mode: false,
  block_hidden_participations: false,
  allow_password_authentication: true,
  allow_registration: false,
  ip_restriction: false,
  ip_autologin: false,
  token_mode: 'disabled',
  token_max_number: null,
  token_min_interval: 0, // seconds
  token_gen_initial: 0,
  token_gen_number: 0,
  token_gen_interval: 30, // minutes
  token_gen_max: null,
  max_user_test_number: null,
  per_user_time: null,
  min_submission_interval_grace_period: null,
  queue_fairness_penalty_seconds: 0,
  analysis_enabled: false,
};

export function emptyContestForm(): ContestFormData {
  return {
    ...COMMON_DEFAULTS,
    name: '',
    description: '',
    start: '',
    stop: '',
    languages: [],
    max_submission_number: null,
    min_submission_interval: null,
    min_user_test_interval: null,
    score_precision: 0,
    analysis_start: '',
    analysis_stop: '',
  };
}

export function defaultNewContestForm(): ContestFormData {
  const now = new Date();
  const end = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const analysisStart = new Date(end.getTime() + 1000);
  const analysisStop = new Date(end.getTime() + 1000 * 60 * 60);
  const zone = COMMON_DEFAULTS.timezone;

  return {
    ...COMMON_DEFAULTS,
    name: '',
    description: '',
    start: formatDateForInput(now, zone),
    stop: formatDateForInput(end, zone),
    languages: [...PROGRAMMING_LANGUAGES],
    max_submission_number: 100,
    min_submission_interval: 60,
    min_user_test_interval: 60,
    score_precision: 2,
    analysis_start: formatDateForInput(analysisStart, zone),
    analysis_stop: formatDateForInput(analysisStop, zone),
  };
}

function contestTimingFields(
  contest: ExistingContest
): Pick<ContestFormData, 'start' | 'stop' | 'timezone' | 'languages' | 'allowed_localizations'> {
  const zone = contest.timezone || COMMON_DEFAULTS.timezone;
  return {
    start: formatDateForInput(contest.start, zone),
    stop: formatDateForInput(contest.stop, zone),
    timezone: zone,
    languages: contest.languages || [],
    allowed_localizations: (contest.allowed_localizations || []).join(', '),
  };
}

function contestAccessFields(
  contest: ExistingContest
): Pick<
  ContestFormData,
  | 'submissions_download_allowed'
  | 'allow_questions'
  | 'allow_user_tests'
  | 'allow_unofficial_submission_before_analysis_mode'
  | 'block_hidden_participations'
  | 'allow_password_authentication'
  | 'allow_registration'
  | 'ip_restriction'
  | 'ip_autologin'
> {
  return {
    submissions_download_allowed: contest.submissions_download_allowed,
    allow_questions: contest.allow_questions,
    allow_user_tests: contest.allow_user_tests,
    allow_unofficial_submission_before_analysis_mode: contest.allow_unofficial_submission_before_analysis_mode,
    block_hidden_participations: contest.block_hidden_participations,
    allow_password_authentication: contest.allow_password_authentication,
    allow_registration: contest.allow_registration,
    ip_restriction: contest.ip_restriction,
    ip_autologin: contest.ip_autologin,
  };
}

function contestTokenFields(
  contest: ExistingContest
): Pick<
  ContestFormData,
  | 'token_mode'
  | 'token_max_number'
  | 'token_min_interval'
  | 'token_gen_initial'
  | 'token_gen_number'
  | 'token_gen_interval'
  | 'token_gen_max'
> {
  return {
    token_mode: contest.token_mode,
    token_max_number: contest.token_max_number,
    token_min_interval: contest.token_min_interval == null ? 0 : parseInterval(contest.token_min_interval),
    token_gen_initial: contest.token_gen_initial,
    token_gen_number: contest.token_gen_number,
    token_gen_interval: contest.token_gen_interval == null ? 30 : Math.round(parseInterval(contest.token_gen_interval) / 60),
    token_gen_max: contest.token_gen_max,
  };
}

/**
 * A stored interval reads as "no limit" when it is absent or zero — the same rule as typed input,
 * so a row that holds `0 seconds` shows an empty box rather than a 0 the API would refuse.
 */
function storedLimitSeconds(value: ExistingContest['min_submission_interval']): number | null {
  if (value === null || value === undefined) return null;
  return normalizeLimitValue(parseInterval(value));
}

function contestLimitFields(
  contest: ExistingContest,
  zone: string
): Pick<
  ContestFormData,
  | 'max_submission_number'
  | 'max_user_test_number'
  | 'min_submission_interval'
  | 'min_user_test_interval'
  | 'per_user_time'
  | 'min_submission_interval_grace_period'
  | 'queue_fairness_penalty_seconds'
  | 'score_precision'
  | 'analysis_enabled'
  | 'analysis_start'
  | 'analysis_stop'
> {
  return {
    max_submission_number: contest.max_submission_number,
    max_user_test_number: contest.max_user_test_number,
    min_submission_interval: storedLimitSeconds(contest.min_submission_interval),
    min_user_test_interval: storedLimitSeconds(contest.min_user_test_interval),
    per_user_time: storedLimitSeconds(contest.per_user_time),
    min_submission_interval_grace_period: storedLimitSeconds(contest.min_submission_interval_grace_period),
    queue_fairness_penalty_seconds: contest.queue_fairness_penalty_seconds ?? 0,
    score_precision: contest.score_precision,
    analysis_enabled: contest.analysis_enabled,
    analysis_start: formatDateForInput(contest.analysis_start, zone),
    analysis_stop: formatDateForInput(contest.analysis_stop, zone),
  };
}

export function formFromContest(contest: ExistingContest): ContestFormData {
  return {
    name: contest.name,
    description: contest.description,
    ...contestTimingFields(contest),
    ...contestAccessFields(contest),
    ...contestTokenFields(contest),
    ...contestLimitFields(contest, contest.timezone || COMMON_DEFAULTS.timezone),
  };
}

export function buildPayload(formData: ContestFormData): ContestData {
  const payload: ContestData = {
    ...formData,
    // Why the limits are normalised on the way out as well as at the control: a form can be seeded
    // from a row an older panel wrote, and the API must never receive the 0 the schema's CHECK
    // refuses. The two interval columns are plain numbers in the API's ContestData, so a cleared
    // interval leaves its key absent instead of null — the validator reads an absent key as "no
    // minimum", which is the same statement.
    max_submission_number: normalizeLimitValue(formData.max_submission_number),
    max_user_test_number: normalizeLimitValue(formData.max_user_test_number),
    token_max_number: normalizeLimitValue(formData.token_max_number),
    token_gen_max: normalizeLimitValue(formData.token_gen_max),
    min_submission_interval: normalizeLimitValue(formData.min_submission_interval) ?? undefined,
    min_user_test_interval: normalizeLimitValue(formData.min_user_test_interval) ?? undefined,
    per_user_time: normalizeLimitValue(formData.per_user_time),
    min_submission_interval_grace_period: normalizeLimitValue(formData.min_submission_interval_grace_period),
  };

  if (typeof payload.allowed_localizations === 'string') {
    payload.allowed_localizations = payload.allowed_localizations
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
  }
  payload.queue_fairness_penalty_seconds = Math.max(0, Number(payload.queue_fairness_penalty_seconds ?? 0) || 0);
  return toZoneInstants(payload, formData.timezone);
}
