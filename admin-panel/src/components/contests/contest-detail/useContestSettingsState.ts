'use client';

import { useContext, useMemo, useState } from 'react';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useJustSavedFlag } from '@/hooks/useJustSavedFlag';
import { DictionaryContext } from '@/hooks/useDictionary';
import { useRecordTabRefresh } from '@/hooks/useRecordTabRefresh';
import { updateContestSettings } from '@/app/actions/contests';
import { buildConfirmationCopy, type ConfirmationCopy } from '@/lib/confirmation-copy';
import type { ContestData } from '@/lib/contests-repo';
import type { ContestOverviewData, ContestSettingsFields } from '@/lib/queries/contest-detail';
import en from '@/dictionaries/en.json';

// Why the alias: the contest tab actions keep their own name while reading the
// one shared refresh handle every record layout registers.
export function useTabRefresh(): () => void {
  return useRecordTabRefresh();
}

// Why: useConfirmationCopy throws without a DictionaryProvider, which unit
// tests do not mount — reading the context directly with an English fallback
// keeps the same localized copy in production and a static copy in tests.
export function useTabConfirmationCopy(): ConfirmationCopy {
  const dictionary = useContext(DictionaryContext);
  return useMemo(
    () => buildConfirmationCopy((dictionary ?? en).confirmations),
    [dictionary],
  );
}

export interface ContestSettingsFormState {
  name: string;
  description: string;
  timezone: string;
  allow_questions: boolean;
  allow_user_tests: boolean;
  submissions_download_allowed: boolean;
  allow_password_authentication: boolean;
  allow_registration: boolean;
  analysis_enabled: boolean;
  token_mode: string;
  score_precision: number;
  start: string;
  stop: string;
  analysis_start: string;
  analysis_stop: string;
}

// Why: datetime-local inputs need the truncated UTC form the old detail view
// produced, while null or unparsable values stay empty instead of crashing.
function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : value.slice(0, 16);
}

const DEFAULT_FIELD_VALUES = {
  timezone: '',
  allow_questions: false,
  allow_user_tests: false,
  submissions_download_allowed: false,
  allow_password_authentication: false,
  allow_registration: false,
  analysis_enabled: false,
  token_mode: 'disabled',
  score_precision: 0,
} as const;

// Why: the overview reader carries no settings fields, so unowned inputs rest
// on neutral defaults — the overview payload below never sends them.
export function toOverviewFormState(contest: ContestOverviewData['contest']): ContestSettingsFormState {
  return {
    name: contest.name,
    description: contest.description,
    ...DEFAULT_FIELD_VALUES,
    start: toLocalInput(contest.start),
    stop: toLocalInput(contest.stop),
    analysis_start: toLocalInput(contest.analysis_start),
    analysis_stop: toLocalInput(contest.analysis_stop),
  };
}

export function toSettingsFormState(fields: ContestSettingsFields): ContestSettingsFormState {
  return {
    name: fields.name,
    description: fields.description,
    timezone: fields.timezone ?? '',
    allow_questions: fields.allow_questions,
    allow_user_tests: fields.allow_user_tests,
    submissions_download_allowed: fields.submissions_download_allowed,
    allow_password_authentication: fields.allow_password_authentication,
    allow_registration: fields.allow_registration,
    analysis_enabled: fields.analysis_enabled,
    token_mode: fields.token_mode,
    score_precision: fields.score_precision,
    start: toLocalInput(fields.start),
    stop: toLocalInput(fields.stop),
    analysis_start: toLocalInput(fields.analysis_start),
    analysis_stop: toLocalInput(fields.analysis_stop),
  };
}

export function useContestSettingsState(
  contestId: number,
  initial: ContestSettingsFormState,
  buildPayload: (form: ContestSettingsFormState) => Partial<ContestData>,
): {
  formData: ContestSettingsFormState;
  updateForm: (patch: Partial<ContestSettingsFormState>) => void;
  saving: boolean;
  justSaved: boolean;
  handleSave: () => Promise<void>;
} {
  const [formData, setFormData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { justSaved, flashSaved } = useJustSavedFlag();
  const runAction = useActionFeedback();
  const refresh = useTabRefresh();

  const updateForm = (patch: Partial<ContestSettingsFormState>): void => {
    setFormData((previous) => ({ ...previous, ...patch }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await runAction(
        { pending: 'Saving contest...', success: 'Contest saved', failure: 'Save failed' },
        () => updateContestSettings(contestId, buildPayload(formData)),
      );
      if (result?.success) {
        flashSaved();
        refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return { formData, updateForm, saving, justSaved, handleSave };
}
