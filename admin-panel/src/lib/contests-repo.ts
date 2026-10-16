import { prisma } from '@/lib/prisma';
import { intervalToString, CONSTRAINT_TO_FIELD_MAP, getConstraintErrorMessage } from '@/lib/contest-validation';
import { LIMIT_FIELDS, normalizeLimitValue, normalizeNonNegativeInt, type LimitFieldName } from '@/lib/limits';
import { contestSortOrderBy } from '@/lib/contest-sorting';
import type { ListSortInput } from '@/lib/list-sorting';

export interface ContestData {
  name: string;
  description: string;
  start: string | Date;
  stop: string | Date;
  timezone: string;
  allowed_localizations?: string[];
  languages?: string[];
  submissions_download_allowed?: boolean;
  allow_questions?: boolean;
  allow_user_tests?: boolean;
  allow_unofficial_submission_before_analysis_mode?: boolean;
  block_hidden_participations?: boolean;
  allow_password_authentication?: boolean;
  allow_registration?: boolean;
  ip_restriction?: boolean;
  ip_autologin?: boolean;
  token_mode?: string;
  token_max_number?: number | null;
  token_min_interval?: number;
  token_gen_initial?: number;
  token_gen_number?: number;
  token_gen_interval?: number;
  token_gen_max?: number | null;
  max_submission_number?: number | null;
  max_user_test_number?: number | null;
  // Why nullable like the two counts above: a cleared interval is stored as SQL NULL, and the
  // "absent = leave alone / null = clear" distinction only exists if the type admits the null.
  min_submission_interval?: number | null;
  min_user_test_interval?: number | null;
  queue_fairness_penalty_seconds?: number;
  score_precision?: number;
  analysis_enabled?: boolean;
  analysis_start?: string | Date;
  analysis_stop?: string | Date;
  per_user_time?: number | null;
  min_submission_interval_grace_period?: number | null;
  evaluation_throttle_delay_s?: number;
  evaluation_throttle_window_s?: number;
  evaluation_throttle_max?: number;
  evaluation_final_open?: boolean;
  evaluation_final_open_at?: string | Date | null;
}

const CONTESTS_PER_PAGE = 20;

export async function fetchContestsPage({ page = 1, search = '', sort = null }: { page?: number; search?: string; sort?: ListSortInput }) {
  const skip = (page - 1) * CONTESTS_PER_PAGE;

  const where = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { description: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {};

  const [contests, total] = await Promise.all([
    prisma.contests.findMany({
      where,
      skip,
      take: CONTESTS_PER_PAGE,
      orderBy: contestSortOrderBy(sort),
      include: {
        _count: { select: { participations: true, contest_tasks: true } },
      },
    }),
    prisma.contests.count({ where }),
  ]);

  return {
    contests,
    totalPages: Math.ceil(total / CONTESTS_PER_PAGE),
    total,
  };
}

// Maps Prisma/Postgres errors on contest writes to user-facing validation errors
export function mapContestDbError(error: unknown) {
  const e = error as Error & { code?: string };

  for (const [constraint, field] of Object.entries(CONSTRAINT_TO_FIELD_MAP)) {
    if (e.message?.includes(constraint)) {
      return {
        success: false,
        errors: [{ field, message: getConstraintErrorMessage(constraint), code: constraint }],
        error: getConstraintErrorMessage(constraint)
      };
    }
  }

  if (e.code === 'P2002' || e.message?.includes('unique constraint')) {
    return { success: false, error: 'Contest name already exists' };
  }
  return { success: false, error: e.message };
}

/** A nullable interval as the "N unit" string Postgres reads, or null for a real NULL (no minimum). */
function nullableIntervalSeconds(value: number | null | undefined, unit: 'seconds' | 'minutes'): string | null {
  const seconds = normalizeLimitValue(value);
  return seconds === null ? null : intervalToString(seconds, unit);
}

export function buildContestInsertDefaults(data: ContestData) {
  const stopDate = new Date(data.stop);
  return {
    startDate: new Date(data.start),
    stopDate,
    analysisStart: data.analysis_start ? new Date(data.analysis_start) : new Date(stopDate.getTime() + 1000),
    analysisStop: data.analysis_stop ? new Date(data.analysis_stop) : new Date(stopDate.getTime() + 2000),
    languages: data.languages || [],
    allowed_localizations: data.allowed_localizations || [],
    token_mode: data.token_mode || 'disabled',
    token_min_interval: intervalToString(data.token_min_interval || 0, 'seconds'),
    token_gen_interval: intervalToString(data.token_gen_interval || 30, 'minutes'),
    // Why NULL and not '0 seconds': these columns' CHECK is `> '0 seconds'`, so "no minimum" must be
    // absent, and the shared rule already reads a 0 or a blank as no minimum.
    min_submission_interval: nullableIntervalSeconds(data.min_submission_interval, 'seconds'),
    min_user_test_interval: nullableIntervalSeconds(data.min_user_test_interval, 'seconds'),
    per_user_time: nullableIntervalSeconds(data.per_user_time, 'seconds'),
    min_submission_interval_grace_period: nullableIntervalSeconds(data.min_submission_interval_grace_period, 'seconds'),
    queue_fairness_penalty_seconds: Math.max(0, Number(data.queue_fairness_penalty_seconds ?? 0) || 0),
    // Why the shared non-negative rule rather than the limit rule: these are NOT NULL columns whose 0
    // is a real value, so the create must write a number (0 when the form gives none), never the NULL
    // the column cannot hold.
    evaluation_throttle_delay_s: normalizeNonNegativeInt(data.evaluation_throttle_delay_s) ?? 0,
    evaluation_throttle_window_s: normalizeNonNegativeInt(data.evaluation_throttle_window_s) ?? 0,
    evaluation_throttle_max: normalizeNonNegativeInt(data.evaluation_throttle_max) ?? 0,
    evaluation_final_open: data.evaluation_final_open ?? false,
  };
}

export async function insertContestRow(data: ContestData, d: ReturnType<typeof buildContestInsertDefaults>): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO contests (
      name, description, allowed_localizations, languages,
      submissions_download_allowed, allow_questions, allow_user_tests,
      allow_unofficial_submission_before_analysis_mode, block_hidden_participations,
      allow_password_authentication, allow_registration, ip_restriction, ip_autologin,
      token_mode, token_max_number, token_min_interval,
      token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
      max_submission_number, max_user_test_number, min_submission_interval, min_user_test_interval,
      queue_fairness_penalty_seconds,
      evaluation_throttle_delay_s, evaluation_throttle_window_s,
      evaluation_throttle_max, evaluation_final_open,
      start, stop, analysis_enabled, analysis_start, analysis_stop,
      score_precision, timezone, per_user_time, min_submission_interval_grace_period
    ) VALUES (
      ${data.name}, ${data.description}, ${d.allowed_localizations}, ${d.languages},
      ${data.submissions_download_allowed ?? true}, ${data.allow_questions ?? true}, ${data.allow_user_tests ?? false},
      ${data.allow_unofficial_submission_before_analysis_mode ?? false}, ${data.block_hidden_participations ?? false},
      ${data.allow_password_authentication ?? true}, ${data.allow_registration ?? false},
      ${data.ip_restriction ?? false}, ${data.ip_autologin ?? false},
      ${d.token_mode}::token_mode, ${data.token_max_number ?? null}, ${d.token_min_interval}::interval,
      ${data.token_gen_initial ?? 0}, ${data.token_gen_number ?? 0}, ${d.token_gen_interval}::interval, ${data.token_gen_max ?? null},
      ${data.max_submission_number ?? null}, ${data.max_user_test_number ?? null},
      ${d.min_submission_interval}::interval, ${d.min_user_test_interval}::interval,
      ${d.queue_fairness_penalty_seconds},
      ${d.evaluation_throttle_delay_s}, ${d.evaluation_throttle_window_s},
      ${d.evaluation_throttle_max}, ${d.evaluation_final_open},
      ${d.startDate}, ${d.stopDate},
      ${data.analysis_enabled ?? false}, ${d.analysisStart}, ${d.analysisStop},
      ${data.score_precision ?? 0}, ${data.timezone},
      ${d.per_user_time}::interval, ${d.min_submission_interval_grace_period}::interval
    )
  `;
}

/**
 * One column's write decision: `touched` says whether the patch named the column at all, `value`
 * is what it names (a number or interval string, or null for an explicit clear).
 *
 * Why the pair rather than the value alone: once a value is bound, an omitted column and an
 * explicit clear both reach Postgres as NULL, so a value-only param ends up either nulling every
 * omitted column (the old bug that made a window-only update wipe the four limit columns) or never
 * being able to clear one. The flag keeps "leave alone" and "clear" apart in one statement.
 */
interface LimitUpdateParam<T> {
  readonly touched: boolean;
  readonly value: T | null;
}

/** The four nullable count limits share the shared limit rule: 0/blank is no limit, i.e. NULL. */
function limitParam(data: Partial<ContestData>, key: LimitFieldName): LimitUpdateParam<number> {
  const touched = data[key] !== undefined;
  return { touched, value: touched ? normalizeLimitValue(data[key]) : null };
}

/**
 * The nullable intervals keyed on the same rule: absent keeps the column, an explicit clear
 * (null, 0, a blank — all "no minimum") writes a real NULL, and a positive number becomes an
 * interval string. token_min_interval and token_gen_interval do not belong here: they are NOT NULL
 * columns with defaults where a stored 0 is legal, so they keep their own strict path below.
 */
function nullableIntervalParam(
  data: Partial<ContestData>,
  key: 'min_submission_interval' | 'min_user_test_interval' | 'per_user_time' | 'min_submission_interval_grace_period',
): LimitUpdateParam<string> {
  const touched = data[key] !== undefined;
  const seconds = touched ? normalizeLimitValue(data[key]) : null;
  return { touched, value: seconds === null ? null : intervalToString(seconds, 'seconds') };
}

/** The always-present interval columns: absent keeps the column, a value is written as typed. */
function strictIntervalParam(
  data: Partial<ContestData>,
  key: 'token_min_interval' | 'token_gen_interval',
  unit: 'seconds' | 'minutes',
): LimitUpdateParam<string> {
  const raw = data[key];
  const touched = raw !== undefined && raw !== null;
  return { touched, value: touched ? intervalToString(Number(raw) || 0, unit) : null };
}

function buildLimitUpdateParams(data: Partial<ContestData>) {
  return {
    token_max_number: limitParam(data, 'token_max_number'),
    token_gen_max: limitParam(data, 'token_gen_max'),
    max_submission_number: limitParam(data, 'max_submission_number'),
    max_user_test_number: limitParam(data, 'max_user_test_number'),
    min_submission_interval: nullableIntervalParam(data, 'min_submission_interval'),
    min_user_test_interval: nullableIntervalParam(data, 'min_user_test_interval'),
    per_user_time: nullableIntervalParam(data, 'per_user_time'),
    min_submission_interval_grace_period: nullableIntervalParam(data, 'min_submission_interval_grace_period'),
    token_min_interval: strictIntervalParam(data, 'token_min_interval', 'seconds'),
    token_gen_interval: strictIntervalParam(data, 'token_gen_interval', 'minutes'),
  };
}

/**
 * One throttle column's write decision, in the same {touched, value} shape the limit columns use.
 *
 * Why not the shared limit rule for the delay: evaluation_throttle_delay_s is NOT NULL and its 0 is
 * a real value ("no throttle delay of my own"), so the rule keeps a 0 instead of turning it into the
 * NULL the column cannot hold; ?? 0 covers a blank or a refused entry, which the column stores as its
 * own 0. The three reserved columns ride the same terms so a caller that ever names them writes one
 * and a form that does not (they render disabled) leaves the column alone — never an unconditional
 * write.
 */
function throttleIntParam(
  data: Partial<ContestData>,
  key: 'evaluation_throttle_delay_s' | 'evaluation_throttle_window_s' | 'evaluation_throttle_max',
): LimitUpdateParam<number> {
  const touched = data[key] !== undefined;
  return { touched, value: touched ? (normalizeNonNegativeInt(data[key]) ?? 0) : null };
}

function buildThrottleUpdateParams(data: Partial<ContestData>) {
  const finalOpenTouched = data.evaluation_final_open !== undefined;
  const finalOpenAtTouched = data.evaluation_final_open_at !== undefined;
  return {
    evaluation_throttle_delay_s: throttleIntParam(data, 'evaluation_throttle_delay_s'),
    evaluation_throttle_window_s: throttleIntParam(data, 'evaluation_throttle_window_s'),
    evaluation_throttle_max: throttleIntParam(data, 'evaluation_throttle_max'),
    evaluation_final_open: { touched: finalOpenTouched, value: finalOpenTouched ? Boolean(data.evaluation_final_open) : null } as LimitUpdateParam<boolean>,
    // Why null is written here: the column is nullable, so an explicit clear is a real NULL.
    evaluation_final_open_at: { touched: finalOpenAtTouched, value: finalOpenAtTouched && data.evaluation_final_open_at != null ? new Date(data.evaluation_final_open_at) : null } as LimitUpdateParam<Date>,
  };
}

function resolveUpdateDateParams(data: Partial<ContestData>) {
  const toDate = (d: string | Date | undefined) => (d ? new Date(d) : undefined);
  return {
    startDate: toDate(data.start),
    stopDate: toDate(data.stop),
    analysisStart: toDate(data.analysis_start),
    analysisStop: toDate(data.analysis_stop),
    queueFairnessSeconds: data.queue_fairness_penalty_seconds !== undefined
      ? Math.max(0, Number(data.queue_fairness_penalty_seconds) || 0)
      : null,
  };
}

export async function executeContestUpdate(id: number, data: Partial<ContestData>): Promise<void> {
  const lim = buildLimitUpdateParams(data);
  const thr = buildThrottleUpdateParams(data);
  const { startDate, stopDate, analysisStart, analysisStop, queueFairnessSeconds } = resolveUpdateDateParams(data);
  await prisma.$executeRaw`
    UPDATE contests SET
      name = COALESCE(${data.name}, name), description = COALESCE(${data.description}, description),
      allowed_localizations = COALESCE(${data.allowed_localizations}, allowed_localizations), languages = COALESCE(${data.languages}, languages),
      start = COALESCE(${startDate}, start), stop = COALESCE(${stopDate}, stop), timezone = COALESCE(${data.timezone}, timezone),
      submissions_download_allowed = COALESCE(${data.submissions_download_allowed}, submissions_download_allowed),
      allow_questions = COALESCE(${data.allow_questions}, allow_questions), allow_user_tests = COALESCE(${data.allow_user_tests}, allow_user_tests), allow_unofficial_submission_before_analysis_mode = COALESCE(${data.allow_unofficial_submission_before_analysis_mode}, allow_unofficial_submission_before_analysis_mode),
      block_hidden_participations = COALESCE(${data.block_hidden_participations}, block_hidden_participations),
      allow_password_authentication = COALESCE(${data.allow_password_authentication}, allow_password_authentication),
      allow_registration = COALESCE(${data.allow_registration}, allow_registration),
      ip_restriction = COALESCE(${data.ip_restriction}, ip_restriction), ip_autologin = COALESCE(${data.ip_autologin}, ip_autologin),
      token_mode = COALESCE(${data.token_mode}::token_mode, token_mode),
      -- Limits: an omitted column keeps its current value; a named column writes what it names, a
      -- value or an explicit NULL clear. Why the flag and not COALESCE alone: COALESCE cannot
      -- express "clear this column", so it would make "no limit" unwritable, and binding only the
      -- value would null every omitted column.
      token_max_number = CASE WHEN ${lim.token_max_number.touched} THEN ${lim.token_max_number.value} ELSE token_max_number END,
      token_gen_max = CASE WHEN ${lim.token_gen_max.touched} THEN ${lim.token_gen_max.value} ELSE token_gen_max END,
      max_submission_number = CASE WHEN ${lim.max_submission_number.touched} THEN ${lim.max_submission_number.value} ELSE max_submission_number END,
      max_user_test_number = CASE WHEN ${lim.max_user_test_number.touched} THEN ${lim.max_user_test_number.value} ELSE max_user_test_number END,
      token_gen_initial = COALESCE(${data.token_gen_initial}, token_gen_initial), token_gen_number = COALESCE(${data.token_gen_number}, token_gen_number),
      queue_fairness_penalty_seconds = COALESCE(${queueFairnessSeconds}, queue_fairness_penalty_seconds), score_precision = COALESCE(${data.score_precision}, score_precision),
      analysis_enabled = COALESCE(${data.analysis_enabled}, analysis_enabled),
      analysis_start = COALESCE(${analysisStart}, analysis_start), analysis_stop = COALESCE(${analysisStop}, analysis_stop),
      -- Intervals: same absent-vs-clear rule, so "no minimum" is a real NULL.
      token_min_interval = CASE WHEN ${lim.token_min_interval.touched} THEN ${lim.token_min_interval.value}::interval ELSE token_min_interval END,
      token_gen_interval = CASE WHEN ${lim.token_gen_interval.touched} THEN ${lim.token_gen_interval.value}::interval ELSE token_gen_interval END,
      min_submission_interval = CASE WHEN ${lim.min_submission_interval.touched} THEN ${lim.min_submission_interval.value}::interval ELSE min_submission_interval END,
      min_user_test_interval = CASE WHEN ${lim.min_user_test_interval.touched} THEN ${lim.min_user_test_interval.value}::interval ELSE min_user_test_interval END,
      per_user_time = CASE WHEN ${lim.per_user_time.touched} THEN ${lim.per_user_time.value}::interval ELSE per_user_time END,
      min_submission_interval_grace_period = CASE WHEN ${lim.min_submission_interval_grace_period.touched} THEN ${lim.min_submission_interval_grace_period.value}::interval ELSE min_submission_interval_grace_period END,
      -- Throttle family: the same absent-vs-named rule. The delay's 0 is written as a 0 (never NULL),
      -- and the three reserved columns are only touched if a caller names them.
      evaluation_throttle_delay_s = CASE WHEN ${thr.evaluation_throttle_delay_s.touched} THEN ${thr.evaluation_throttle_delay_s.value} ELSE evaluation_throttle_delay_s END,
      evaluation_throttle_window_s = CASE WHEN ${thr.evaluation_throttle_window_s.touched} THEN ${thr.evaluation_throttle_window_s.value} ELSE evaluation_throttle_window_s END,
      evaluation_throttle_max = CASE WHEN ${thr.evaluation_throttle_max.touched} THEN ${thr.evaluation_throttle_max.value} ELSE evaluation_throttle_max END,
      evaluation_final_open = CASE WHEN ${thr.evaluation_final_open.touched} THEN ${thr.evaluation_final_open.value} ELSE evaluation_final_open END,
      evaluation_final_open_at = CASE WHEN ${thr.evaluation_final_open_at.touched} THEN ${thr.evaluation_final_open_at.value} ELSE evaluation_final_open_at END
    WHERE id = ${id}
  `;
}
