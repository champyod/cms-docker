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

export const CONSTRAINT_TO_FIELD_MAP: Record<string, string> = {
  contests_check: 'stop',
  contests_check1: 'analysis_start',
  contests_check2: 'analysis_stop',
  contests_check3: 'token_gen_max',
  contests_max_submission_number_check: 'max_submission_number',
  contests_max_user_test_number_check: 'max_user_test_number',
  contests_min_submission_interval_check: 'min_submission_interval',
  contests_min_user_test_interval_check: 'min_user_test_interval',
  contests_per_user_time_check: 'per_user_time',
  contests_score_precision_check: 'score_precision',
  contests_token_gen_initial_check: 'token_gen_initial',
  contests_token_gen_interval_check: 'token_gen_interval',
  contests_token_gen_max_check: 'token_gen_max',
  contests_token_gen_number_check: 'token_gen_number',
  contests_token_max_number_check: 'token_max_number',
  contests_min_submission_interval_grace_period_check: 'min_submission_interval_grace_period',
};

export const parseInterval = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) return parseInt(val);
    const parts = val.split(':').map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
  if (typeof val === 'object') {
    let total = 0;
    if (val.days !== undefined) total += val.days * 24 * 3600;
    if (val.hours !== undefined) total += val.hours * 3600;
    if (val.minutes !== undefined) total += val.minutes * 60;
    if (val.seconds !== undefined) total += val.seconds;
    return total;
  }
  return 0;
};

export function intervalToString(seconds: number, unit: 'seconds' | 'minutes' = 'seconds'): string {
  return `${seconds} ${unit}`;
}

export function getConstraintErrorMessage(constraint: string): string {
  switch (constraint) {
    case 'contests_check':
      return 'Start time must be before or equal to stop time';
    case 'contests_check1':
      return 'Analysis start must be after contest ends';
    case 'contests_check2':
      return 'Analysis start must be before analysis stop';
    case 'contests_check3':
      return 'Initial tokens cannot exceed max tokens cap';
    case 'contests_max_submission_number_check':
      return 'Max submission number must be greater than 0';
    case 'contests_max_user_test_number_check':
      return 'Max user test number must be greater than 0';
    case 'contests_min_submission_interval_check':
      return 'Minimum submission interval must be greater than 0';
    case 'contests_min_user_test_interval_check':
      return 'Minimum user test interval must be greater than 0';
    case 'contests_per_user_time_check':
      return 'Per-user time cannot be negative';
    case 'contests_score_precision_check':
      return 'Score precision cannot be negative';
    case 'contests_token_gen_initial_check':
      return 'Initial tokens cannot be negative';
    case 'contests_token_gen_interval_check':
      return 'Token generation interval must be greater than 0';
    case 'contests_token_gen_max_check':
      return 'Token generation max cap must be greater than 0';
    case 'contests_token_gen_number_check':
      return 'Token generation number cannot be negative';
    case 'contests_token_max_number_check':
      return 'Token max number must be greater than 0';
    case 'contests_min_submission_interval_grace_period_check':
      return 'Min submission interval grace period cannot be negative';
    default:
      return 'Validation constraint failed';
  }
}

export function validateContestData(
  data: ContestData,
  isUpdate = false
): {
  valid: boolean;
  errors: Array<{ field: string; message: string; code: string }>;
} {
  const errors: Array<{ field: string; message: string; code: string }> = [];

  const toDate = (d: any): Date | null => {
    if (!d) return null;
    const date = new Date(d);
    return isNaN(date.getTime()) ? null : date;
  };

  // Helper to check if a property is present and not undefined
  const has = (key: keyof ContestData) => data[key] !== undefined;

  // 1. start <= stop
  if (has('start') && has('stop')) {
    const start = toDate(data.start);
    const stop = toDate(data.stop);
    if (start && stop && start > stop) {
      errors.push({
        field: 'stop',
        message: getConstraintErrorMessage('contests_check'),
        code: 'contests_check',
      });
    }
  }

  // 2. stop <= analysis_start
  // In the DB stop <= analysis_start constraint is always enforced if values are set.
  // Note: analysisStart defaults to stop + 1s when not provided/enabled.
  if (has('stop') && has('analysis_start')) {
    const stop = toDate(data.stop);
    const analysisStart = toDate(data.analysis_start);
    if (stop && analysisStart && stop > analysisStart) {
      errors.push({
        field: 'analysis_start',
        message: getConstraintErrorMessage('contests_check1'),
        code: 'contests_check1',
      });
    }
  }

  // 3. analysis_start <= analysis_stop
  if (has('analysis_start') && has('analysis_stop')) {
    const analysisStart = toDate(data.analysis_start);
    const analysisStop = toDate(data.analysis_stop);
    if (analysisStart && analysisStop && analysisStart > analysisStop) {
      errors.push({
        field: 'analysis_stop',
        message: getConstraintErrorMessage('contests_check2'),
        code: 'contests_check2',
      });
    }
  }

  // 4. score_precision >= 0
  if (has('score_precision') && data.score_precision !== null) {
    if (data.score_precision! < 0) {
      errors.push({
        field: 'score_precision',
        message: getConstraintErrorMessage('contests_score_precision_check'),
        code: 'contests_score_precision_check',
      });
    }
  }

  // 5. token_gen_initial >= 0
  if (has('token_gen_initial') && data.token_gen_initial !== null) {
    if (data.token_gen_initial! < 0) {
      errors.push({
        field: 'token_gen_initial',
        message: getConstraintErrorMessage('contests_token_gen_initial_check'),
        code: 'contests_token_gen_initial_check',
      });
    }
  }

  // 6. token_gen_number >= 0
  if (has('token_gen_number') && data.token_gen_number !== null) {
    if (data.token_gen_number! < 0) {
      errors.push({
        field: 'token_gen_number',
        message: getConstraintErrorMessage('contests_token_gen_number_check'),
        code: 'contests_token_gen_number_check',
      });
    }
  }

  // 7. token_min_interval >= 0
  if (has('token_min_interval') && data.token_min_interval !== null) {
    if (data.token_min_interval! < 0) {
      errors.push({
        field: 'token_min_interval',
        message: 'Minimum token interval cannot be negative',
        code: 'contests_token_min_interval_check', // internal code
      });
    }
  }

  // 8. token_gen_interval > 0 (when token_mode=finite)
  if (data.token_mode === 'finite' && has('token_gen_interval') && data.token_gen_interval !== null) {
    if (data.token_gen_interval! <= 0) {
      errors.push({
        field: 'token_gen_interval',
        message: getConstraintErrorMessage('contests_token_gen_interval_check'),
        code: 'contests_token_gen_interval_check',
      });
    }
  }

  // 9. token_gen_initial <= token_gen_max (when both set)
  if (
    has('token_gen_initial') &&
    has('token_gen_max') &&
    data.token_gen_initial !== null &&
    data.token_gen_max !== null
  ) {
    if (data.token_gen_initial! > data.token_gen_max!) {
      errors.push({
        field: 'token_gen_max',
        message: getConstraintErrorMessage('contests_check3'),
        code: 'contests_check3',
      });
    }
  }

  // 10. token_max_number > 0 (when token_mode is not disabled and token_max_number is set)
  if (data.token_mode !== 'disabled' && has('token_max_number') && data.token_max_number !== null) {
    if (data.token_max_number! <= 0) {
      errors.push({
        field: 'token_max_number',
        message: getConstraintErrorMessage('contests_token_max_number_check'),
        code: 'contests_token_max_number_check',
      });
    }
  }

  // 11. token_gen_max > 0 (when set)
  if (has('token_gen_max') && data.token_gen_max !== null) {
    if (data.token_gen_max! <= 0) {
      errors.push({
        field: 'token_gen_max',
        message: getConstraintErrorMessage('contests_token_gen_max_check'),
        code: 'contests_token_gen_max_check',
      });
    }
  }

  // 12. max_submission_number > 0 (when set)
  if (has('max_submission_number') && data.max_submission_number !== null) {
    if (data.max_submission_number! <= 0) {
      errors.push({
        field: 'max_submission_number',
        message: getConstraintErrorMessage('contests_max_submission_number_check'),
        code: 'contests_max_submission_number_check',
      });
    }
  }

  // 13. max_user_test_number > 0 (when set)
  if (has('max_user_test_number') && data.max_user_test_number !== null) {
    if (data.max_user_test_number! <= 0) {
      errors.push({
        field: 'max_user_test_number',
        message: getConstraintErrorMessage('contests_max_user_test_number_check'),
        code: 'contests_max_user_test_number_check',
      });
    }
  }

  // 14. min_submission_interval > 0 (when set)
  if (has('min_submission_interval') && data.min_submission_interval !== null) {
    if (data.min_submission_interval! <= 0) {
      errors.push({
        field: 'min_submission_interval',
        message: getConstraintErrorMessage('contests_min_submission_interval_check'),
        code: 'contests_min_submission_interval_check',
      });
    }
  }

  // 15. min_user_test_interval > 0 (when set)
  if (has('min_user_test_interval') && data.min_user_test_interval !== null) {
    if (data.min_user_test_interval! <= 0) {
      errors.push({
        field: 'min_user_test_interval',
        message: getConstraintErrorMessage('contests_min_user_test_interval_check'),
        code: 'contests_min_user_test_interval_check',
      });
    }
  }

  // 16. per_user_time >= 0 (when set)
  if (has('per_user_time') && data.per_user_time !== null) {
    if (data.per_user_time! < 0) {
      errors.push({
        field: 'per_user_time',
        message: getConstraintErrorMessage('contests_per_user_time_check'),
        code: 'contests_per_user_time_check',
      });
    }
  }

  // 17. min_submission_interval_grace_period >= 0 (when set)
  if (has('min_submission_interval_grace_period') && data.min_submission_interval_grace_period !== null) {
    if (data.min_submission_interval_grace_period! < 0) {
      errors.push({
        field: 'min_submission_interval_grace_period',
        message: getConstraintErrorMessage('contests_min_submission_interval_grace_period_check'),
        code: 'contests_min_submission_interval_grace_period_check',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
