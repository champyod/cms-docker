'use client';

import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
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
      <label className={LABEL_CLASSES}>Max Submissions</label>
      <UnlimitedNumberInput
        value={formData.max_submission_number}
        onChangeValue={(v) => setFormData({ ...formData, max_submission_number: v })}
        hasError={validationErrors.has('max_submission_number')}
      />
      <ErrorText errors={validationErrors} field="max_submission_number" />
    </div>
  );
}

function MinSubmissionIntervalField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Min Interval (sec)</label>
      <input
        type="number"
        value={formData.min_submission_interval}
        onChange={(e) => setFormData({ ...formData, min_submission_interval: parseInt(e.target.value) || 0 })}
        className={fieldClasses(validationErrors.has('min_submission_interval'))}
      />
      <ErrorText errors={validationErrors} field="min_submission_interval" />
    </div>
  );
}

function MaxUserTestsField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Max User Tests</label>
      <UnlimitedNumberInput
        value={formData.max_user_test_number}
        onChangeValue={(v) => setFormData({ ...formData, max_user_test_number: v })}
        hasError={validationErrors.has('max_user_test_number')}
      />
      <ErrorText errors={validationErrors} field="max_user_test_number" />
    </div>
  );
}

function MinUserTestIntervalField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Min User Test Interval (sec)</label>
      <input
        type="number"
        value={formData.min_user_test_interval}
        onChange={(e) => setFormData({ ...formData, min_user_test_interval: parseInt(e.target.value) || 0 })}
        className={fieldClasses(validationErrors.has('min_user_test_interval'))}
      />
      <ErrorText errors={validationErrors} field="min_user_test_interval" />
    </div>
  );
}

function QueueFairnessField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Queue Fairness Penalty (sec)</label>
      <input
        type="number"
        min={0}
        title="Queue Fairness Penalty (seconds)"
        placeholder="0"
        value={formData.queue_fairness_penalty_seconds}
        onChange={(e) => setFormData({ ...formData, queue_fairness_penalty_seconds: Math.max(0, parseInt(e.target.value) || 0) })}
        className={fieldClasses(validationErrors.has('queue_fairness_penalty_seconds'))}
      />
      <p className="text-[11px] text-muted-foreground">0 disables fairness delay. Formula: submission time + n × seconds.</p>
      <ErrorText errors={validationErrors} field="queue_fairness_penalty_seconds" />
    </div>
  );
}

function ScorePrecisionField({ formData, setFormData, validationErrors }: LimitsTabProps) {
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Score Precision (decimals)</label>
      <input
        type="number"
        value={formData.score_precision}
        onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })}
        className={fieldClasses(validationErrors.has('score_precision'))}
      />
      <ErrorText errors={validationErrors} field="score_precision" />
    </div>
  );
}

export function LimitsTab(props: LimitsTabProps) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
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
