'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import { getFieldAccess, type FieldAccess } from '@/lib/field-permissions';
import { ContestModalShell } from './contest-modal/ContestModalShell';
import { useContestForm } from './contest-modal/useContestForm';
import { useContestSubmit } from './contest-modal/useContestSubmit';
import { TabContentRouter } from './contest-modal/TabContentRouter';
import type { ContestModalProps, ContestModalTab } from './contest-modal/types';

// Why: child tab components can consume this context to wrap individual fields with RestrictedField.
export const FieldAccessContext = createContext<Record<string, FieldAccess>>({});
export function useFieldAccess(): Record<string, FieldAccess> {
  return useContext(FieldAccessContext);
}

interface ContestModalWithPermsProps extends ContestModalProps {
  permissionKeys?: readonly string[];
}

export function ContestModal(props: ContestModalWithPermsProps) {
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

  const fieldAccess = useMemo(() => {
    const perms = new Set(props.permissionKeys ?? []);
    return getFieldAccess('contests', perms);
  }, [props.permissionKeys]);

  if (!props.isOpen) return null;

  return (
    <FieldAccessContext.Provider value={fieldAccess}>
      <ContestModalShell
        contest={props.contest} onClose={props.onClose} loading={loading} error={form.error}
        validationErrors={form.validationErrors} activeTab={activeTab} setActiveTab={setActiveTab} onSubmit={handleSubmit}
      >
        <TabContentRouter
          activeTab={activeTab} formData={form.formData} setFormData={form.setFormData} validationErrors={form.validationErrors}
          analysisEditedRef={form.analysisEditedRef} onLanguageToggle={form.handleLanguageToggle}
        />
      </ContestModalShell>
    </FieldAccessContext.Provider>
  );
}
