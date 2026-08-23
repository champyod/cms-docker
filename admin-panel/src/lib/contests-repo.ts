import { prisma } from '@/lib/prisma';
import { intervalToString, CONSTRAINT_TO_FIELD_MAP, getConstraintErrorMessage } from '@/lib/contest-validation';

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
  min_submission_interval?: number;
  min_user_test_interval?: number;
  queue_fairness_penalty_seconds?: number;
  score_precision?: number;
  analysis_enabled?: boolean;
  analysis_start?: string | Date;
  analysis_stop?: string | Date;
  per_user_time?: number | null;
  min_submission_interval_grace_period?: number | null;
}

const CONTESTS_PER_PAGE = 20;

export async function fetchContestsPage({ page = 1, search = '' }: { page?: number; search?: string }) {
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
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { participations: true, tasks: true } },
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
    min_submission_interval: intervalToString(data.min_submission_interval || 0, 'seconds'),
    min_user_test_interval: intervalToString(data.min_user_test_interval || 0, 'seconds'),
    per_user_time: data.per_user_time !== undefined && data.per_user_time !== null
      ? intervalToString(data.per_user_time, 'seconds')
      : null,
    min_submission_interval_grace_period: data.min_submission_interval_grace_period !== undefined && data.min_submission_interval_grace_period !== null
      ? intervalToString(data.min_submission_interval_grace_period, 'seconds')
      : null,
    queue_fairness_penalty_seconds: Math.max(0, Number(data.queue_fairness_penalty_seconds ?? 0) || 0),
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
      queue_fairness_penalty_seconds, start, stop, analysis_enabled, analysis_start, analysis_stop,
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
      ${d.queue_fairness_penalty_seconds}, ${d.startDate}, ${d.stopDate},
      ${data.analysis_enabled ?? false}, ${d.analysisStart}, ${d.analysisStop},
      ${data.score_precision ?? 0}, ${data.timezone},
      ${d.per_user_time}::interval, ${d.min_submission_interval_grace_period}::interval
    )
  `;
}

function buildUpdateIntervalParams(data: Partial<ContestData>) {
  const optionalInterval = (
    value: number | undefined | null,
    unit: 'seconds' | 'minutes'
  ): string | null => (value !== undefined && value !== null ? intervalToString(value, unit) : null);

  return {
    token_min_interval: optionalInterval(data.token_min_interval, 'seconds'),
    token_gen_interval: optionalInterval(data.token_gen_interval, 'minutes'),
    min_submission_interval: optionalInterval(data.min_submission_interval, 'seconds'),
    min_user_test_interval: optionalInterval(data.min_user_test_interval, 'seconds'),
    per_user_time: optionalInterval(data.per_user_time, 'seconds'),
    min_submission_interval_grace_period: optionalInterval(data.min_submission_interval_grace_period, 'seconds'),
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
  const iv = buildUpdateIntervalParams(data);
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
      token_max_number = ${data.token_max_number}, token_gen_max = ${data.token_gen_max},
      max_submission_number = ${data.max_submission_number}, max_user_test_number = ${data.max_user_test_number},
      token_gen_initial = COALESCE(${data.token_gen_initial}, token_gen_initial), token_gen_number = COALESCE(${data.token_gen_number}, token_gen_number),
      queue_fairness_penalty_seconds = COALESCE(${queueFairnessSeconds}, queue_fairness_penalty_seconds), score_precision = COALESCE(${data.score_precision}, score_precision),
      analysis_enabled = COALESCE(${data.analysis_enabled}, analysis_enabled),
      analysis_start = COALESCE(${analysisStart}, analysis_start), analysis_stop = COALESCE(${analysisStop}, analysis_stop),
      -- Intervals
      token_min_interval = CASE WHEN ${iv.token_min_interval}::text IS NOT NULL THEN ${iv.token_min_interval}::interval ELSE token_min_interval END,
      token_gen_interval = CASE WHEN ${iv.token_gen_interval}::text IS NOT NULL THEN ${iv.token_gen_interval}::interval ELSE token_gen_interval END,
      min_submission_interval = CASE WHEN ${iv.min_submission_interval}::text IS NOT NULL THEN ${iv.min_submission_interval}::interval ELSE min_submission_interval END,
      min_user_test_interval = CASE WHEN ${iv.min_user_test_interval}::text IS NOT NULL THEN ${iv.min_user_test_interval}::interval ELSE min_user_test_interval END,
      per_user_time = CASE WHEN ${iv.per_user_time}::text IS NOT NULL THEN ${iv.per_user_time}::interval ELSE per_user_time END,
      min_submission_interval_grace_period = CASE WHEN ${iv.min_submission_interval_grace_period}::text IS NOT NULL THEN ${iv.min_submission_interval_grace_period}::interval ELSE min_submission_interval_grace_period END
    WHERE id = ${id}
  `;
}
