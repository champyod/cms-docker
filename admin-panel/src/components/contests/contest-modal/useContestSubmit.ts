'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '@/lib/apiClient';
import type { ApiResponse } from '@/lib/apiClient';
import { validateContestData } from '@/lib/contest-validation';
import type { ContestData } from '@/lib/contest-validation';
import { toast } from 'sonner';
import { buildPayload } from './contestFormMappers';
import { FIELD_TO_TAB_MAP } from './types';
import type { ApiFieldError, ContestFormData, ContestModalTab, ExistingContest } from './types';

interface SubmitContext {
  contest: ExistingContest | null | undefined;
  formData: ContestFormData;
  onSuccess: () => void;
  onClose: () => void;
  setActiveTab: (tab: ContestModalTab) => void;
  setValidationErrors: (errors: Map<string, string>) => void;
  setError: (message: string) => void;
}

function collectNameErrors(formData: ContestFormData): Map<string, string> {
  const tempErrors = new Map<string, string>();
  const nameRegex = /^[A-Za-z0-9_-]+$/;
  if (!formData.name) {
    tempErrors.set('name', 'Contest name is required');
  } else if (!nameRegex.test(formData.name)) {
    tempErrors.set('name', 'Contest name must contain only letters, numbers, hyphens and underscores');
  }
  return tempErrors;
}

function focusFirstErrorTab(errorsMap: Map<string, string>, setActiveTab: (tab: ContestModalTab) => void): void {
  const firstErrorField = Array.from(errorsMap.keys())[0];
  const targetTab = FIELD_TO_TAB_MAP[firstErrorField];
  if (targetTab) {
    setActiveTab(targetTab);
  }
}

function hasBlockingValidationErrors(
  deps: SubmitContext,
  payload: ContestData,
  tempErrors: Map<string, string>
): boolean {
  const validation = validateContestData(payload);
  if (!validation.valid || tempErrors.size > 0) {
    const errorsMap = new Map<string, string>(tempErrors);
    validation.errors.forEach(err => {
      errorsMap.set(err.field, err.message);
    });
    deps.setValidationErrors(errorsMap);
    focusFirstErrorTab(errorsMap, deps.setActiveTab);

    deps.setError('Please fix the validation errors before saving');
    toast.error('Validation Error', { description: 'Please fix the errors before saving' });
    return true;
  }
  return false;
}

function applyApiFieldErrors(deps: SubmitContext, result: ApiResponse): void {
  if (result.errors && Array.isArray(result.errors)) {
    const apiErrorsMap = new Map<string, string>();
    result.errors.forEach((err: ApiFieldError) => {
      apiErrorsMap.set(err.field, err.message);
    });
    deps.setValidationErrors(apiErrorsMap);
    focusFirstErrorTab(apiErrorsMap, deps.setActiveTab);
  }
}

async function submitToApi(deps: SubmitContext, payload: ContestData): Promise<void> {
  const result = deps.contest
    ? await apiClient.put(`/api/contests/${deps.contest.id}`, payload)
    : await apiClient.post('/api/contests', payload);

  if (result.success) {
    toast.success(deps.contest ? 'Contest Updated' : 'Contest Created', {
      description: `Successfully ${deps.contest ? 'updated' : 'created'} contest "${deps.formData.name}"`,
    });
    deps.onSuccess();
    deps.onClose();
  } else {
    const msg = result.error || 'Operation failed';
    deps.setError(msg);
    applyApiFieldErrors(deps, result);
    toast.error('Error', { description: msg });
  }
}

function reportUnexpectedError(deps: SubmitContext): void {
  const msg = 'An unexpected error occurred';
  deps.setError(msg);
  toast.error('Error', { description: msg });
}

export function useContestSubmit(submitContext: SubmitContext) {
  const { formData, setError, setValidationErrors } = submitContext;
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setValidationErrors(new Map());

    const tempErrors = collectNameErrors(formData);

    try {
      const payload = buildPayload(formData);
      if (!hasBlockingValidationErrors(submitContext, payload, tempErrors)) {
        await submitToApi(submitContext, payload);
      }
    } catch {
      reportUnexpectedError(submitContext);
    } finally {
      setLoading(false);
    }
  };

  return { handleSubmit, loading };
}
