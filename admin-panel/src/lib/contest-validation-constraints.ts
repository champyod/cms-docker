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

export const CONSTRAINT_MESSAGES: Record<string, string> = {
  contests_check: 'Start time must be before or equal to stop time',
  contests_check1: 'Analysis start must be after contest ends',
  contests_check2: 'Analysis start must be before analysis stop',
  contests_check3: 'Initial tokens cannot exceed max tokens cap',
  contests_max_submission_number_check: 'Max submission number must be greater than 0',
  contests_max_user_test_number_check: 'Max user test number must be greater than 0',
  contests_min_submission_interval_check: 'Minimum submission interval must be greater than 0',
  contests_min_user_test_interval_check: 'Minimum user test interval must be greater than 0',
  contests_per_user_time_check: 'Per-user time cannot be negative',
  contests_score_precision_check: 'Score precision cannot be negative',
  contests_token_gen_initial_check: 'Initial tokens cannot be negative',
  contests_token_gen_interval_check: 'Token generation interval must be greater than 0',
  contests_token_gen_max_check: 'Token generation max cap must be greater than 0',
  contests_token_gen_number_check: 'Token generation number cannot be negative',
  contests_token_max_number_check: 'Token max number must be greater than 0',
  contests_min_submission_interval_grace_period_check: 'Min submission interval grace period cannot be negative',
};

export function getConstraintErrorMessage(constraint: string): string {
  return CONSTRAINT_MESSAGES[constraint] ?? 'Validation constraint failed';
}
