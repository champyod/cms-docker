import type { Dispatch, SetStateAction } from 'react';

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
  queue_fairness_penalty_seconds?: number;
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
  min_submission_interval: number; // seconds
  min_user_test_interval: number; // seconds
  queue_fairness_penalty_seconds: number;
  score_precision: number;
  analysis_enabled: boolean;
  analysis_start: string;
  analysis_stop: string;
}

export type SetContestForm = Dispatch<SetStateAction<ContestFormData>>;

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
