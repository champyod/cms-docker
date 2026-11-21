import type { Dispatch, SetStateAction } from 'react';

import type { LimitFieldName } from '@/lib/limits';

export interface ContestModalProps {
  isOpen: boolean;
  onClose: () => void;
  contest?: ExistingContest | null;
  onSuccess: () => void;
}

export interface ContestIntervalValue {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export interface ExistingContest {
  id: number;
  name: string;
  description: string;
  start: Date | string;
  stop: Date | string;
  timezone?: string | null;
  allowed_localizations?: string[];
  languages?: string[];
  submissions_download_allowed: boolean;
  allow_questions: boolean;
  allow_user_tests: boolean;
  allow_unofficial_submission_before_analysis_mode: boolean;
  block_hidden_participations: boolean;
  allow_password_authentication: boolean;
  allow_registration: boolean;
  ip_restriction: boolean;
  ip_autologin: boolean;
  token_mode: string;
  token_max_number: number | null;
  token_min_interval?: number | string | ContestIntervalValue | null;
  token_gen_initial: number;
  token_gen_number: number;
  token_gen_interval?: number | string | ContestIntervalValue | null;
  token_gen_max: number | null;
  max_submission_number: number | null;
  max_user_test_number: number | null;
  min_submission_interval?: number | string | ContestIntervalValue | null;
  min_user_test_interval?: number | string | ContestIntervalValue | null;
  per_user_time?: number | string | ContestIntervalValue | null;
  min_submission_interval_grace_period?: number | string | ContestIntervalValue | null;
  queue_fairness_penalty_seconds?: number;
  evaluation_throttle_delay_s?: number;
  evaluation_throttle_window_s?: number;
  evaluation_throttle_max?: number;
  evaluation_final_open?: boolean;
  evaluation_final_open_at?: string | null;
  score_precision: number;
  analysis_enabled: boolean;
  analysis_start?: Date | string | null;
  analysis_stop?: Date | string | null;
}

export interface ContestFormData {
  name: string;
  description: string;
  start: string;
  stop: string;
  timezone: string;
  languages: string[];
  allowed_localizations: string;
  submissions_download_allowed: boolean;
  allow_questions: boolean;
  allow_user_tests: boolean;
  allow_unofficial_submission_before_analysis_mode: boolean;
  block_hidden_participations: boolean;
  allow_password_authentication: boolean;
  allow_registration: boolean;
  ip_restriction: boolean;
  ip_autologin: boolean;
  token_mode: string;
  token_max_number: number | null;
  token_min_interval: number; // seconds
  token_gen_initial: number;
  token_gen_number: number;
  token_gen_interval: number; // minutes
  token_gen_max: number | null;
  max_submission_number: number | null;
  max_user_test_number: number | null;
  // Why these two are nullable like the other four: an empty box and a 0 both mean "no minimum
  // interval", and the panel must never hand the API the 0 its validator refuses.
  min_submission_interval: number | null; // seconds
  min_user_test_interval: number | null; // seconds
  per_user_time: number | null; // seconds
  min_submission_interval_grace_period: number | null; // seconds
  queue_fairness_penalty_seconds: number;
  // Why the delay is a plain number and not `number | null`: its column is NOT NULL and its 0 is a
  // real value ("no throttle delay of my own"), so there is no "unset" state to represent. The other
  // four are display-only here; the form carries them so the modal can show the schema, and the
  // payload builder drops them so a disabled control can never write.
  evaluation_throttle_delay_s: number;
  evaluation_throttle_window_s: number;
  evaluation_throttle_max: number;
  evaluation_final_open: boolean;
  evaluation_final_open_at: string;
  score_precision: number;
  analysis_enabled: boolean;
  analysis_start: string;
  analysis_stop: string;
}

export type SetContestForm = Dispatch<SetStateAction<ContestFormData>>;

/** Every field the shared LimitField owns, whichever tab renders it. */
export type ContestLimitField = Extract<
  keyof ContestFormData,
  LimitFieldName | 'per_user_time' | 'min_submission_interval_grace_period'
>;

export type ContestModalTab = 'general' | 'access' | 'tokens' | 'limits' | 'analysis';

export const FIELD_TO_TAB_MAP: Record<string, ContestModalTab> = {
  name: 'general',
  description: 'general',
  start: 'general',
  stop: 'general',
  timezone: 'general',
  allowed_localizations: 'general',
  languages: 'general',
  allow_registration: 'access',
  allow_password_authentication: 'access',
  ip_restriction: 'access',
  ip_autologin: 'access',
  submissions_download_allowed: 'access',
  allow_questions: 'access',
  block_hidden_participations: 'access',
  token_mode: 'tokens',
  token_max_number: 'tokens',
  token_min_interval: 'tokens',
  token_gen_initial: 'tokens',
  token_gen_number: 'tokens',
  token_gen_interval: 'tokens',
  token_gen_max: 'tokens',
  max_submission_number: 'limits',
  max_user_test_number: 'limits',
  min_submission_interval: 'limits',
  min_user_test_interval: 'limits',
  queue_fairness_penalty_seconds: 'limits',
  evaluation_throttle_delay_s: 'limits',
  evaluation_throttle_window_s: 'limits',
  evaluation_throttle_max: 'limits',
  evaluation_final_open: 'limits',
  evaluation_final_open_at: 'limits',
  score_precision: 'limits',
  per_user_time: 'limits',
  min_submission_interval_grace_period: 'limits',
  analysis_enabled: 'analysis',
  analysis_start: 'analysis',
  analysis_stop: 'analysis',
};

export interface ApiFieldError {
  field: string;
  message: string;
}
