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
import { collectZoneTimeErrors, rezoneTimeFields, toZoneInstants } from '../contest-modal/contestFormMappers';
import { utcToZoneWallClock } from '@/lib/timezone';
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

// Why: datetime-local inputs show the wall clock the contest's own zone names, so an instant read
// from the server is converted here; null or unparsable values stay empty instead of crashing.
function toLocalInput(value: string | null, zone: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : utcToZoneWallClock(date.toISOString(), zone);
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
// on neutral defaults — the overview payload below never sends them. The zone is
// the exception: the summary carries it, and the timing pickers read in it.
export function toOverviewFormState(contest: ContestOverviewData['contest']): ContestSettingsFormState {
  const zone = contest.timezone ?? '';
  return {
    name: contest.name,
    description: contest.description,
    ...DEFAULT_FIELD_VALUES,
    timezone: zone,
    start: toLocalInput(contest.start, zone),
    stop: toLocalInput(contest.stop, zone),
    analysis_start: toLocalInput(contest.analysis_start, zone),
    analysis_stop: toLocalInput(contest.analysis_stop, zone),
  };
}

export function toSettingsFormState(fields: ContestSettingsFields): ContestSettingsFormState {
  const zone = fields.timezone ?? '';
  return {
    name: fields.name,
    description: fields.description,
    timezone: zone,
    allow_questions: fields.allow_questions,
    allow_user_tests: fields.allow_user_tests,
    submissions_download_allowed: fields.submissions_download_allowed,
    allow_password_authentication: fields.allow_password_authentication,
    allow_registration: fields.allow_registration,
    analysis_enabled: fields.analysis_enabled,
    token_mode: fields.token_mode,
    score_precision: fields.score_precision,
    start: toLocalInput(fields.start, zone),
    stop: toLocalInput(fields.stop, zone),
    analysis_start: toLocalInput(fields.analysis_start, zone),
    analysis_stop: toLocalInput(fields.analysis_stop, zone),
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
  timeErrors: Record<string, string>;
  handleSave: () => Promise<void>;
} {
  const [formData, setFormData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [timeErrors, setTimeErrors] = useState<Record<string, string>>({});
  const { justSaved, flashSaved } = useJustSavedFlag();
  const runAction = useActionFeedback();
  const refresh = useTabRefresh();

  // Why: changing the zone re-projects the four wall clocks to the same instants, so the pickers
  // follow the live timezone field and never re-read the old digits as a new wall clock.
  const updateForm = (patch: Partial<ContestSettingsFormState>): void => {
    setFormData((previous) => rezoneTimeFields(previous, { ...previous, ...patch }));
  };

  const handleSave = async (): Promise<void> => {
    // Why the zone check precedes the action: a DST gap or repeat has no instant to store, so the
    // save stops on the field rather than writing a shifted time the operator never chose.
    const blocked = Object.fromEntries(collectZoneTimeErrors(formData, formData.timezone));
    setTimeErrors(blocked);
    if (Object.keys(blocked).length > 0) return;

    setSaving(true);
    try {
      const result = await runAction(
        { pending: 'Saving contest...', success: 'Contest saved', failure: 'Save failed' },
        () => updateContestSettings(contestId, toZoneInstants(buildPayload(formData), formData.timezone)),
      );
      if (result?.success) {
        flashSaved();
        refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return { formData, updateForm, saving, justSaved, timeErrors, handleSave };
}
