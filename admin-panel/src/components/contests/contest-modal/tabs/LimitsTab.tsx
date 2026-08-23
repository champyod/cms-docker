'use client';

import { cn } from '@/lib/utils';
import { UnlimitedNumberInput } from '../shared/UnlimitedNumberInput';
import type { ContestFormData, SetContestForm } from '../types';

interface LimitsTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
}

function MaxSubmissionsField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max Submissions</label>
      <UnlimitedNumberInput
        value={formData.max_submission_number}
        onChangeValue={(v) => setFormData({ ...formData, max_submission_number: v })}
        hasError={validationErrors.has('max_submission_number')}
      />
      {validationErrors.has('max_submission_number') && (
        <p className="text-xs text-red-500">{validationErrors.get('max_submission_number')}</p>
      )}
    </div>
  );
}

function MinSubmissionIntervalField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Min Interval (sec)</label>
      <input
        type="number"
        value={formData.min_submission_interval}
        onChange={(e) => setFormData({ ...formData, min_submission_interval: parseInt(e.target.value) || 0 })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
          validationErrors.has('min_submission_interval') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has('min_submission_interval') && (
        <p className="text-xs text-red-500">{validationErrors.get('min_submission_interval')}</p>
      )}
    </div>
  );
}

function MaxUserTestsField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max User Tests</label>
      <UnlimitedNumberInput
        value={formData.max_user_test_number}
        onChangeValue={(v) => setFormData({ ...formData, max_user_test_number: v })}
        hasError={validationErrors.has('max_user_test_number')}
      />
      {validationErrors.has('max_user_test_number') && (
        <p className="text-xs text-red-500">{validationErrors.get('max_user_test_number')}</p>
      )}
    </div>
  );
}

function MinUserTestIntervalField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Min User Test Interval (sec)</label>
      <input
        type="number"
        value={formData.min_user_test_interval}
        onChange={(e) => setFormData({ ...formData, min_user_test_interval: parseInt(e.target.value) || 0 })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
          validationErrors.has('min_user_test_interval') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has('min_user_test_interval') && (
        <p className="text-xs text-red-500">{validationErrors.get('min_user_test_interval')}</p>
      )}
    </div>
  );
}

function QueueFairnessField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Queue Fairness Penalty (sec)</label>
      <input
        type="number"
        min={0}
        title="Queue Fairness Penalty (seconds)"
        placeholder="0"
        value={formData.queue_fairness_penalty_seconds}
        onChange={(e) => setFormData({ ...formData, queue_fairness_penalty_seconds: Math.max(0, parseInt(e.target.value) || 0) })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
          validationErrors.has('queue_fairness_penalty_seconds') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      <p className="text-[11px] text-neutral-500">0 disables fairness delay. Formula: submission time + n × seconds.</p>
      {validationErrors.has('queue_fairness_penalty_seconds') && (
        <p className="text-xs text-red-500">{validationErrors.get('queue_fairness_penalty_seconds')}</p>
      )}
    </div>
  );
}

function ScorePrecisionField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Score Precision (decimals)</label>
      <input
        type="number"
        value={formData.score_precision}
        onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
          validationErrors.has('score_precision') ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
        )}
      />
      {validationErrors.has('score_precision') && (
        <p className="text-xs text-red-500">{validationErrors.get('score_precision')}</p>
      )}
    </div>
  );
}

export function LimitsTab(props: LimitsTabProps) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* LIMITS TAB */}
      <div className="grid grid-cols-2 gap-6">
        <MaxSubmissionsField {...props} />
        <MinSubmissionIntervalField {...props} />
        <MaxUserTestsField {...props} />
        <MinUserTestIntervalField {...props} />
        <QueueFairnessField {...props} />
        <ScorePrecisionField {...props} />
      </div>
    </div>
  );
}
