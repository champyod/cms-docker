'use client';

import { ToggleSwitch } from '../shared/ToggleSwitch';
import type { ContestFormData, SetContestForm } from '../types';

type AccessToggleKey = Extract<
  keyof ContestFormData,
  | 'allow_registration'
  | 'allow_password_authentication'
  | 'ip_restriction'
  | 'ip_autologin'
  | 'block_hidden_participations'
  | 'allow_questions'
  | 'allow_user_tests'
  | 'submissions_download_allowed'
>;

interface AccessToggle {
  key: AccessToggleKey;
  label: string;
}

const ACCESS_TOGGLES: AccessToggle[] = [
  { key: 'allow_registration', label: 'Allow Public Registration' },
  { key: 'allow_password_authentication', label: 'Allow Password Authentication' },
  { key: 'ip_restriction', label: 'Use IP Restriction' },
  { key: 'ip_autologin', label: 'Use IP Auto-Login' },
  { key: 'block_hidden_participations', label: 'Block Hidden Participations' },
  { key: 'allow_questions', label: 'Allow Questions' },
  { key: 'allow_user_tests', label: 'Allow User Tests' },
  { key: 'submissions_download_allowed', label: 'Allow Submissions Download' },
];

interface AccessTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
}

export function AccessTab({ formData, setFormData }: AccessTabProps) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      {ACCESS_TOGGLES.map(item => (
        <div key={item.key} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4">
          <span className="text-sm font-medium text-foreground">{item.label}</span>
          <ToggleSwitch
            checked={formData[item.key]}
            onToggle={() => setFormData({ ...formData, [item.key]: !formData[item.key] })}
          />
        </div>
      ))}
    </div>
  );
}
