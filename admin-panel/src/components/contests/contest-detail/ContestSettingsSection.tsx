'use client';

import { Card } from '@/components/core/Card';
import { ToggleSwitch } from '../contest-modal/shared/ToggleSwitch';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface FormState {
  name: string; description: string; timezone: string;
  allow_questions: boolean; allow_user_tests: boolean; submissions_download_allowed: boolean;
  allow_password_authentication: boolean; allow_registration: boolean; analysis_enabled: boolean;
}

interface Props {
  formData: FormState;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FormState>) => void;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-foreground">{label}</label>
      <ToggleSwitch checked={checked} onToggle={() => onChange(!checked)} />
    </div>
  );
}

export function ContestSettingsSection({ formData, expanded, onToggle, onChange }: Props) {
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center justify-between p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3"><Settings className="h-5 w-5 text-primary" /><span className="font-bold text-foreground">Contest Settings</span></div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="grid grid-cols-1 gap-4 p-4 pt-0 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLASSES}>Name</label>
              <input type="text" value={formData.name} onChange={(e) => onChange({ name: e.target.value })} className={FIELD_CLASSES} />
            </div>
            <div>
              <label className={LABEL_CLASSES}>Description</label>
              <textarea value={formData.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} className={FIELD_CLASSES} />
            </div>
            <div>
              <label className={LABEL_CLASSES}>Timezone</label>
              <input type="text" value={formData.timezone} onChange={(e) => onChange({ timezone: e.target.value })} placeholder="Asia/Bangkok" className={FIELD_CLASSES} />
            </div>
          </div>
          <div className="space-y-3">
            <ToggleRow label="Allow Questions" checked={formData.allow_questions} onChange={(v) => onChange({ allow_questions: v })} />
            <ToggleRow label="Allow User Tests" checked={formData.allow_user_tests} onChange={(v) => onChange({ allow_user_tests: v })} />
            <ToggleRow label="Allow Submissions Download" checked={formData.submissions_download_allowed} onChange={(v) => onChange({ submissions_download_allowed: v })} />
            <ToggleRow label="Allow Password Auth" checked={formData.allow_password_authentication} onChange={(v) => onChange({ allow_password_authentication: v })} />
            <ToggleRow label="Allow Registration" checked={formData.allow_registration} onChange={(v) => onChange({ allow_registration: v })} />
            <ToggleRow label="Analysis Mode" checked={formData.analysis_enabled} onChange={(v) => onChange({ analysis_enabled: v })} />
          </div>
        </div>
      )}
    </Card>
  );
}
