import { getConstraintErrorMessage as getMsg } from './contest-validation-constraints';
import { parseIntervalToSeconds } from './task-intervals';

export { CONSTRAINT_TO_FIELD_MAP, getConstraintErrorMessage } from './contest-validation-constraints';

export interface ContestData {
  name: string;
  description: string;
  start: string | Date;
  stop: string | Date;
  timezone: string;
  allowed_localizations?: string | string[];
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

export function parseInterval(val: unknown): number {
  const result = parseIntervalToSeconds(val);
  if (result === undefined) throw new Error(`Invalid interval value: ${String(val)}`);
  return result;
}

export function intervalToString(seconds: number, unit: 'seconds' | 'minutes' = 'seconds'): string {
  return `${seconds} ${unit}`;
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

type DateField = 'start' | 'stop' | 'analysis_start' | 'analysis_stop';

type NumericField =
  | 'score_precision'
  | 'token_gen_initial'
  | 'token_gen_number'
  | 'token_min_interval'
  | 'token_gen_interval'
  | 'token_gen_max'
  | 'token_max_number'
  | 'max_submission_number'
  | 'max_user_test_number'
  | 'min_submission_interval'
  | 'min_user_test_interval'
  | 'per_user_time'
  | 'min_submission_interval_grace_period';

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

const isPresent = <K extends keyof ContestData>(data: ContestData, key: K): boolean =>
  data[key] !== undefined;

const DATE_ORDER_CHECKS: ReadonlyArray<{ from: DateField; to: DateField; failField: string; code: string }> = [
  { from: 'start', to: 'stop', failField: 'stop', code: 'contests_check' },
  { from: 'stop', to: 'analysis_start', failField: 'analysis_start', code: 'contests_check1' },
  { from: 'analysis_start', to: 'analysis_stop', failField: 'analysis_stop', code: 'contests_check2' },
];

function validateDateOrdering(data: ContestData, errors: ValidationError[]): void {
  for (const check of DATE_ORDER_CHECKS) {
    if (!isPresent(data, check.from) || !isPresent(data, check.to)) continue;
    const from = toDate(data[check.from]);
    const to = toDate(data[check.to]);
    if (from && to && from > to) {
      errors.push({ field: check.failField, message: getMsg(check.code), code: check.code });
    }
  }
}

interface NumericFieldCheck {
  field: NumericField;
  code: string;
  operator: 'gteZero' | 'gtZero';
  message?: string;
  appliesWhen?: (data: ContestData) => boolean;
}

const NUMERIC_BEFORE: NumericFieldCheck[] = [
  { field: 'score_precision', code: 'contests_score_precision_check', operator: 'gteZero' },
  { field: 'token_gen_initial', code: 'contests_token_gen_initial_check', operator: 'gteZero' },
  { field: 'token_gen_number', code: 'contests_token_gen_number_check', operator: 'gteZero' },
  { field: 'token_min_interval', code: 'contests_token_min_interval_check', operator: 'gteZero', message: 'Minimum token interval cannot be negative' },
  { field: 'token_gen_interval', code: 'contests_token_gen_interval_check', operator: 'gtZero', appliesWhen: (d) => d.token_mode === 'finite' },
];

const NUMERIC_AFTER: NumericFieldCheck[] = [
  { field: 'token_max_number', code: 'contests_token_max_number_check', operator: 'gtZero', appliesWhen: (d) => d.token_mode !== 'disabled' },
  { field: 'token_gen_max', code: 'contests_token_gen_max_check', operator: 'gtZero' },
  { field: 'max_submission_number', code: 'contests_max_submission_number_check', operator: 'gtZero' },
  { field: 'max_user_test_number', code: 'contests_max_user_test_number_check', operator: 'gtZero' },
  { field: 'min_submission_interval', code: 'contests_min_submission_interval_check', operator: 'gtZero' },
  { field: 'min_user_test_interval', code: 'contests_min_user_test_interval_check', operator: 'gtZero' },
  { field: 'per_user_time', code: 'contests_per_user_time_check', operator: 'gteZero' },
  { field: 'min_submission_interval_grace_period', code: 'contests_min_submission_interval_grace_period_check', operator: 'gteZero' },
];

function applyNumericChecks(data: ContestData, errors: ValidationError[], checks: NumericFieldCheck[]): void {
  for (const check of checks) {
    if (!isPresent(data, check.field) || data[check.field] === null) continue;
    if (check.appliesWhen && !check.appliesWhen(data)) continue;
    const value = data[check.field]!;
    const violated = check.operator === 'gteZero' ? value < 0 : value <= 0;
    if (!violated) continue;
    errors.push({ field: check.field, message: check.message ?? getMsg(check.code), code: check.code });
  }
}

function validateTokenGenCap(data: ContestData, errors: ValidationError[]): void {
  const hasInitial = isPresent(data, 'token_gen_initial') && data.token_gen_initial !== null;
  const hasCap = isPresent(data, 'token_gen_max') && data.token_gen_max !== null;
  if (!hasInitial || !hasCap || data.token_gen_initial! <= data.token_gen_max!) return;
  errors.push({ field: 'token_gen_max', message: getMsg('contests_check3'), code: 'contests_check3' });
}

export function validateContestData(data: ContestData, isUpdate = false): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
  const errors: ValidationError[] = [];
  void isUpdate;
  validateDateOrdering(data, errors);
  applyNumericChecks(data, errors, NUMERIC_BEFORE);
  validateTokenGenCap(data, errors);
  applyNumericChecks(data, errors, NUMERIC_AFTER);
  return { valid: errors.length === 0, errors };
}
