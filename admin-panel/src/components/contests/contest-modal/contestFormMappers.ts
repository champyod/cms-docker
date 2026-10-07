import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { parseInterval } from '@/lib/contest-validation';
import type { ContestData } from '@/lib/contest-validation';
import type { ContestFormData, ExistingContest } from './types';

export const formatDateForInput = (date?: Date | string | null) => {
    if (!date) return '';
  const d = new Date(date);
    const pad = (n: number) => n < 10 ? '0' + n : n;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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
    min_submission_interval: 0,
    min_user_test_interval: 0,
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

  return {
    ...COMMON_DEFAULTS,
    name: '',
    description: '',
    start: formatDateForInput(now),
    stop: formatDateForInput(end),
    languages: [...PROGRAMMING_LANGUAGES],
    max_submission_number: 100,
    min_submission_interval: 60,
    min_user_test_interval: 60,
    score_precision: 2,
    analysis_start: formatDateForInput(analysisStart),
    analysis_stop: formatDateForInput(analysisStop),
  };
}

function contestTimingFields(
  contest: ExistingContest
): Pick<ContestFormData, 'start' | 'stop' | 'timezone' | 'languages' | 'allowed_localizations'> {
  return {
    start: formatDateForInput(contest.start),
    stop: formatDateForInput(contest.stop),
    timezone: contest.timezone || 'Asia/Bangkok',
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

function contestLimitFields(
  contest: ExistingContest
): Pick<
  ContestFormData,
  | 'max_submission_number'
  | 'max_user_test_number'
  | 'min_submission_interval'
  | 'min_user_test_interval'
  | 'queue_fairness_penalty_seconds'
  | 'score_precision'
  | 'analysis_enabled'
  | 'analysis_start'
  | 'analysis_stop'
> {
  return {
    max_submission_number: contest.max_submission_number,
    max_user_test_number: contest.max_user_test_number,
    min_submission_interval: contest.min_submission_interval == null ? 0 : parseInterval(contest.min_submission_interval),
    min_user_test_interval: contest.min_user_test_interval == null ? 0 : parseInterval(contest.min_user_test_interval),
    queue_fairness_penalty_seconds: contest.queue_fairness_penalty_seconds ?? 0,
    score_precision: contest.score_precision,
    analysis_enabled: contest.analysis_enabled,
    analysis_start: formatDateForInput(contest.analysis_start),
    analysis_stop: formatDateForInput(contest.analysis_stop),
  };
}

export function formFromContest(contest: ExistingContest): ContestFormData {
  return {
    name: contest.name,
    description: contest.description,
    ...contestTimingFields(contest),
    ...contestAccessFields(contest),
    ...contestTokenFields(contest),
    ...contestLimitFields(contest),
  };
}

export function buildPayload(formData: ContestFormData): ContestData {
  const payload: ContestData = { ...formData };

  if (typeof payload.allowed_localizations === 'string') {
    payload.allowed_localizations = payload.allowed_localizations
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
  }
  payload.queue_fairness_penalty_seconds = Math.max(0, Number(payload.queue_fairness_penalty_seconds ?? 0) || 0);
  return payload;
}
