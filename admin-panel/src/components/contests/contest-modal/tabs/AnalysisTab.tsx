'use client';

import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
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
    <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
      <span className="text-sm font-medium text-neutral-300">Enable Analysis Mode</span>
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
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Analysis Start</label>
      <input
        required={formData.analysis_enabled}
        type="datetime-local"
        value={formData.analysis_start}
        onChange={(e) => {
          analysisEditedRef.current = true;
          setFormData({ ...formData, analysis_start: e.target.value });
        }}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white [color-scheme:dark]",
          validationErrors.has('analysis_start') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has('analysis_start') && (
        <p className="text-xs text-red-500">{validationErrors.get('analysis_start')}</p>
      )}
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
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Analysis Stop</label>
      <input
        required={formData.analysis_enabled}
        type="datetime-local"
        value={formData.analysis_stop}
        onChange={(e) => {
          analysisEditedRef.current = true;
          setFormData({ ...formData, analysis_stop: e.target.value });
        }}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white [color-scheme:dark]",
          validationErrors.has('analysis_stop') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has('analysis_stop') && (
        <p className="text-xs text-red-500">{validationErrors.get('analysis_stop')}</p>
      )}
    </div>
  );
}

export function AnalysisTab({ formData, setFormData, validationErrors, analysisEditedRef }: AnalysisTabProps) {
  const fields = { formData, setFormData, validationErrors, analysisEditedRef };
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* ANALYSIS TAB */}
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
