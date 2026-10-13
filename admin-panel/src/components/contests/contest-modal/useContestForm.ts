'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  emptyContestForm,
  defaultNewContestForm,
  formFromContest,
  rezoneTimeFields,
  formatDateForInput,
} from './contestFormMappers';
import { zoneWallClockToInstant } from '@/lib/timezone';
import type { ContestFormData, ExistingContest, SetContestForm } from './types';

interface UseContestFormResult {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  setValidationErrors: (errors: Map<string, string>) => void;
  error: string;
  setError: (message: string) => void;
  analysisEditedRef: RefObject<boolean>;
  handleLanguageToggle: (lang: string) => void;
}

interface ContestSyncArgs {
  isOpen: boolean;
  contest: ExistingContest | null | undefined;
  analysisEditedRef: RefObject<boolean>;
  setFormData: SetContestForm;
  setValidationErrors: (errors: Map<string, string>) => void;
}

interface AutoAnalysisArgs {
  isOpen: boolean;
  stop: string;
  zone: string;
  analysisEnabled: boolean;
  analysisEditedRef: RefObject<boolean>;
  setFormData: SetContestForm;
}

const ANALYSIS_OPEN_OFFSET_MS = 1000;
const ANALYSIS_WINDOW_MS = 3601000;

function applyContestSyncEffect({
  contest,
  analysisEditedRef,
  setFormData,
  setValidationErrors,
}: ContestSyncArgs): void {
  if (contest) {
    setFormData(formFromContest(contest));
  } else {
    setFormData(defaultNewContestForm());
  }
  analysisEditedRef.current = false;
  setValidationErrors(new Map());
}

/** The auto window as the form zone reads it, so moving the zone moves the window with the stop. */
function applyAutoAnalysisWindow({
  isOpen,
  stop,
  zone,
  analysisEnabled,
  analysisEditedRef,
  setFormData,
}: AutoAnalysisArgs): void {
  if (!isOpen) return;
  if (!stop) return;
  const stopInstant = zoneWallClockToInstant(stop, zone);
  if (stopInstant === null) return;

  if (!analysisEnabled || !analysisEditedRef.current) {
    const windowStart = new Date(stopInstant.getTime() + ANALYSIS_OPEN_OFFSET_MS);
    const windowStop = new Date(stopInstant.getTime() + ANALYSIS_WINDOW_MS);
    setFormData(prev => ({
      ...prev,
      analysis_start: formatDateForInput(windowStart, prev.timezone),
      analysis_stop: formatDateForInput(windowStop, prev.timezone),
    }));
  }
}

function toggleLanguage(prev: ContestFormData, lang: string): ContestFormData {
  const exists = prev.languages.includes(lang);
  return {
    ...prev,
    languages: exists
      ? prev.languages.filter(l => l !== lang)
      : [...prev.languages, lang]
  };
}

export function useContestForm(
  isOpen: boolean,
  contest: ExistingContest | null | undefined
): UseContestFormResult {
  const [formData, setFormState] = useState<ContestFormData>(emptyContestForm);
  const [validationErrors, setValidationErrors] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const analysisEditedRef = useRef(false);

  // Why: every tab writes through this setter, so re-projecting here is what makes the pickers
  // follow the live timezone field instead of each tab re-deriving the wall clocks itself. A
  // caller that replaces the whole form skips it: formFromContest and defaultNewContestForm
  // already render their wall clocks in the target zone, so re-projecting converts them twice.
  const setFormData = useCallback<SetContestForm>((action) => {
    setFormState((previous) => rezoneTimeFields(previous, typeof action === 'function' ? action(previous) : action));
  }, []);

  useEffect(() => {
    applyContestSyncEffect({ isOpen, contest, analysisEditedRef, setFormData: setFormState, setValidationErrors });
  }, [contest, isOpen]);

  useEffect(() => {
    applyAutoAnalysisWindow({
      isOpen,
      stop: formData.stop,
      zone: formData.timezone,
      analysisEnabled: formData.analysis_enabled,
      analysisEditedRef,
      setFormData,
    });
  }, [formData.stop, formData.timezone, formData.analysis_enabled, isOpen, setFormData]);

  const handleLanguageToggle = (lang: string) => setFormData(prev => toggleLanguage(prev, lang));

  return {
    formData,
    setFormData,
    validationErrors,
    setValidationErrors,
    error,
    setError,
    analysisEditedRef,
    handleLanguageToggle,
  };
}
