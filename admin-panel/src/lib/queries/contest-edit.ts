import type { Prisma } from '@prisma/client';
import { filterReadableFields } from '@/lib/field-permissions';
import { prisma } from '@/lib/prisma';
import { NO_INTERVALS, toIsoDate, toIntervalString, type IntervalColumns } from '@/lib/queries/read-model-format';

export type ContestEditFields = {
  id: number; name: string; description: string; start: string; stop: string;
  timezone: string | null; allowed_localizations: string[]; languages: string[];
  submissions_download_allowed: boolean; allow_questions: boolean; allow_user_tests: boolean;
  allow_unofficial_submission_before_analysis_mode: boolean; block_hidden_participations: boolean;
  allow_password_authentication: boolean; allow_registration: boolean;
  ip_restriction: boolean; ip_autologin: boolean; token_mode: string;
  token_max_number: number | null; token_min_interval: string | null;
  token_gen_initial: number; token_gen_number: number; token_gen_interval: string | null;
  token_gen_max: number | null; max_submission_number: number | null; max_user_test_number: number | null;
  min_submission_interval: string | null; min_user_test_interval: string | null; queue_fairness_penalty_seconds: number | null;
  score_precision: number; analysis_enabled: boolean; analysis_start: string | null; analysis_stop: string | null;
};

export type ContestEditData = { contest: ContestEditFields; permissionKeys: readonly string[] };

const contestEditSelect = {
  id: true, name: true, description: true, start: true, stop: true, timezone: true,
  allowed_localizations: true, languages: true, submissions_download_allowed: true,
  allow_questions: true, allow_user_tests: true, allow_unofficial_submission_before_analysis_mode: true,
  block_hidden_participations: true, allow_password_authentication: true, allow_registration: true,
  ip_restriction: true, ip_autologin: true, token_mode: true, token_max_number: true,
  token_gen_initial: true, token_gen_number: true, token_gen_max: true,
  max_submission_number: true, max_user_test_number: true,
  queue_fairness_penalty_seconds: true, score_precision: true,
  analysis_enabled: true, analysis_start: true, analysis_stop: true,
} satisfies Prisma.contestsSelect;

async function fetchContestIntervals(contestId: number): Promise<IntervalColumns> {
  try {
    const rows = await prisma.$queryRaw<IntervalColumns[]>`SELECT token_min_interval, token_gen_interval, min_submission_interval, min_user_test_interval FROM contests WHERE id = ${contestId}`;
    return rows[0] ?? NO_INTERVALS;
  } catch {
    // Why degrade, not throw: the interval columns live on a CMS-created table that
    // no admin-panel migration owns, so a schema drift or a connection fault there
    // must leave four cosmetic inputs unset rather than fail the whole edit read —
    // the same reasoning the Task settings read applies to the identical query.
    return NO_INTERVALS;
  }
}

type ContestEditRow = Prisma.contestsGetPayload<{ select: typeof contestEditSelect }> & IntervalColumns;

export async function readContestEditData(contestId: number, permissions: ReadonlySet<string>): Promise<ContestEditData | null> {
  const [row, intervals] = await Promise.all([
    prisma.contests.findUnique({ where: { id: contestId }, select: contestEditSelect }),
    fetchContestIntervals(contestId),
  ]);
  if (!row) return null;
  return { contest: toContestEdit({ ...row, ...intervals }, permissions), permissionKeys: [...permissions] };
}

// Why: on-demand dialog data — the record layout carries only id, name, description, is_active, keys.
function toContestEdit(row: ContestEditRow, permissions: ReadonlySet<string>): ContestEditFields {
  const visible = filterReadableFields('contests', row, permissions);
  const pick = <K extends keyof ContestEditRow>(key: K): ContestEditRow[K] => (visible[key] ?? row[key]) as ContestEditRow[K];
  return {
    id: pick('id'), name: pick('name'), description: pick('description'),
    start: toIsoDate(row.start) ?? '', stop: toIsoDate(row.stop) ?? '',
    timezone: pick('timezone'), allowed_localizations: [...pick('allowed_localizations')], languages: [...pick('languages')],
    submissions_download_allowed: pick('submissions_download_allowed'),
    allow_questions: pick('allow_questions'), allow_user_tests: pick('allow_user_tests'),
    allow_unofficial_submission_before_analysis_mode: pick('allow_unofficial_submission_before_analysis_mode'),
    block_hidden_participations: pick('block_hidden_participations'),
    allow_password_authentication: pick('allow_password_authentication'), allow_registration: pick('allow_registration'),
    ip_restriction: pick('ip_restriction'), ip_autologin: pick('ip_autologin'), token_mode: String(pick('token_mode')),
    token_max_number: pick('token_max_number'), token_min_interval: toIntervalString(pick('token_min_interval')),
    token_gen_initial: pick('token_gen_initial'), token_gen_number: pick('token_gen_number'),
    token_gen_interval: toIntervalString(pick('token_gen_interval')), token_gen_max: pick('token_gen_max'),
    max_submission_number: pick('max_submission_number'), max_user_test_number: pick('max_user_test_number'),
    min_submission_interval: toIntervalString(pick('min_submission_interval')),
    min_user_test_interval: toIntervalString(pick('min_user_test_interval')),
    queue_fairness_penalty_seconds: pick('queue_fairness_penalty_seconds'),
    score_precision: pick('score_precision'), analysis_enabled: pick('analysis_enabled'),
    analysis_start: toIsoDate(row.analysis_start), analysis_stop: toIsoDate(row.analysis_stop),
  };
}
