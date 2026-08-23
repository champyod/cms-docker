'use client';

import { useState } from 'react';
import { ContestModalShell } from './contest-modal/ContestModalShell';
import { useContestForm } from './contest-modal/useContestForm';
import { useContestSubmit } from './contest-modal/useContestSubmit';
import { TabContentRouter } from './contest-modal/TabContentRouter';
import type { ContestModalProps, ContestModalTab } from './contest-modal/types';

export function ContestModal(props: ContestModalProps) {
  const [activeTab, setActiveTab] = useState<ContestModalTab>('general');
  const form = useContestForm(props.isOpen, props.contest);
  const { handleSubmit, loading } = useContestSubmit({
    contest: props.contest,
    formData: form.formData,
    onSuccess: props.onSuccess,
    onClose: props.onClose,
    setActiveTab,
    setValidationErrors: form.setValidationErrors,
    setError: form.setError,
  });

  if (!props.isOpen) return null;

  return (
    <ContestModalShell
      contest={props.contest} onClose={props.onClose} loading={loading} error={form.error}
      validationErrors={form.validationErrors} activeTab={activeTab} setActiveTab={setActiveTab} onSubmit={handleSubmit}
    >
      <TabContentRouter
        activeTab={activeTab} formData={form.formData} setFormData={form.setFormData} validationErrors={form.validationErrors}
        analysisEditedRef={form.analysisEditedRef} onLanguageToggle={form.handleLanguageToggle}
      />
    </ContestModalShell>
  );
}
