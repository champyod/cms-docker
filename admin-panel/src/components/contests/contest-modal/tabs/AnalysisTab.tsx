'use client';

import type { RefObject } from 'react';
import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import type { ContestFormData, SetContestForm } from '../types';

interface AnalysisTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  analysisEditedRef: RefObject<boolean>;
}

function AnalysisToggleRow({
  formData,
  setFormData,
}: Pick<AnalysisTabProps, 'formData' | 'setFormData'>) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4">
      <span className="text-sm font-medium text-foreground">Enable Analysis Mode</span>
      <ToggleSwitch
        checked={formData.analysis_enabled}
        onToggle={() => setFormData({ ...formData, analysis_enabled: !formData.analysis_enabled })}
      />
    </div>
  );
}

function AnalysisStartField({
  formData,
  setFormData,
  validationErrors,
  analysisEditedRef,
}: Pick<AnalysisTabProps, 'formData' | 'setFormData' | 'validationErrors' | 'analysisEditedRef'>) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Analysis Start</label>
      <input
        required={formData.analysis_enabled}
        type="datetime-local"
        value={formData.analysis_start}
        onChange={(e) => {
          analysisEditedRef.current = true;
          setFormData({ ...formData, analysis_start: e.target.value });
        }}
        className={fieldClasses(validationErrors.has('analysis_start'))}
      />
      <ErrorText errors={validationErrors} field="analysis_start" />
    </div>
  );
}

function AnalysisStopField({
  formData,
  setFormData,
  validationErrors,
  analysisEditedRef,
}: Pick<AnalysisTabProps, 'formData' | 'setFormData' | 'validationErrors' | 'analysisEditedRef'>) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Analysis Stop</label>
      <input
        required={formData.analysis_enabled}
        type="datetime-local"
        value={formData.analysis_stop}
        onChange={(e) => {
          analysisEditedRef.current = true;
          setFormData({ ...formData, analysis_stop: e.target.value });
        }}
        className={fieldClasses(validationErrors.has('analysis_stop'))}
      />
      <ErrorText errors={validationErrors} field="analysis_stop" />
    </div>
  );
}

export function AnalysisTab({ formData, setFormData, validationErrors, analysisEditedRef }: AnalysisTabProps) {
  const fields = { formData, setFormData, validationErrors, analysisEditedRef };
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      <AnalysisToggleRow formData={formData} setFormData={setFormData} />
      {formData.analysis_enabled && (
        <div className="grid grid-cols-2 gap-6">
          <AnalysisStartField {...fields} />
          <AnalysisStopField {...fields} />
        </div>
      )}
    </div>
  );
}
