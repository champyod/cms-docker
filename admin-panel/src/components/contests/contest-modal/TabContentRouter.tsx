'use client';

import type { RefObject } from 'react';
import { GeneralTab } from './tabs/GeneralTab';
import { AccessTab } from './tabs/AccessTab';
import { TokensTab } from './tabs/TokensTab';
import { LimitsTab } from './tabs/LimitsTab';
import { AnalysisTab } from './tabs/AnalysisTab';
import type { ContestFormData, ContestModalTab, SetContestForm } from './types';

interface TabContentRouterProps {
  activeTab: ContestModalTab;
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  analysisEditedRef: RefObject<boolean>;
  onLanguageToggle: (lang: string) => void;
}

export function TabContentRouter({
  activeTab,
  formData,
  setFormData,
  validationErrors,
  analysisEditedRef,
  onLanguageToggle,
}: TabContentRouterProps) {
  const baseProps = { formData, setFormData, validationErrors };

  return (
    <>
      {activeTab === 'general' && (
        <GeneralTab {...baseProps} onLanguageToggle={onLanguageToggle} />
      )}
      {activeTab === 'access' && <AccessTab {...baseProps} />}
      {activeTab === 'tokens' && <TokensTab {...baseProps} />}
      {activeTab === 'limits' && <LimitsTab {...baseProps} />}
      {activeTab === 'analysis' && (
        <AnalysisTab {...baseProps} analysisEditedRef={analysisEditedRef} />
      )}
    </>
  );
}
