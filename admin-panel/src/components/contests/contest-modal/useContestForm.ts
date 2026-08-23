'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { emptyContestForm, defaultNewContestForm, formFromContest, formatDateForInput } from './contestFormMappers';
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
  formData: ContestFormData;
  analysisEditedRef: RefObject<boolean>;
  setFormData: SetContestForm;
}

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

function applyAutoAnalysisWindow({
  isOpen,
  formData,
  analysisEditedRef,
  setFormData,
}: AutoAnalysisArgs): void {
  if (!isOpen) return;
  if (!formData.stop) return;
  const stopDate = new Date(formData.stop);
  if (isNaN(stopDate.getTime())) return;

  if (!formData.analysis_enabled || !analysisEditedRef.current) {
    const newStart = new Date(stopDate.getTime() + 1000);
    const newStop = new Date(stopDate.getTime() + 3601000);
    setFormData(prev => ({
      ...prev,
      analysis_start: formatDateForInput(newStart),
      analysis_stop: formatDateForInput(newStop),
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
  const [formData, setFormData] = useState<ContestFormData>(emptyContestForm);
  const [validationErrors, setValidationErrors] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const analysisEditedRef = useRef(false);

  useEffect(() => {
    applyContestSyncEffect({ isOpen, contest, analysisEditedRef, setFormData, setValidationErrors });
  }, [contest, isOpen]);

  useEffect(() => {
    applyAutoAnalysisWindow({ isOpen, formData, analysisEditedRef, setFormData });
  }, [formData.stop, formData.analysis_enabled, isOpen]);

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
