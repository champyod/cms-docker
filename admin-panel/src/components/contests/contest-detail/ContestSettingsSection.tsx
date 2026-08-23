'use client';

import { Card } from '@/components/core/Card';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

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
    <div className="flex items-center justify-between"><label className="text-sm text-neutral-300">{label}</label><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded" /></div>
  );
}

export function ContestSettingsSection({ formData, expanded, onToggle, onChange }: Props) {
  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <button onClick={onToggle} className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3"><Settings className="w-5 h-5 text-indigo-400" /><span className="font-bold text-white">Contest Settings</span></div>
        {expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
      </button>
      {expanded && (
        <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Name</label><input type="text" value={formData.name} onChange={(e) => onChange({ name: e.target.value })} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
            <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Description</label><textarea value={formData.description} onChange={(e) => onChange({ description: e.target.value })} rows={2} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
            <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Timezone</label><input type="text" value={formData.timezone} onChange={(e) => onChange({ timezone: e.target.value })} placeholder="Asia/Bangkok" className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50" /></div>
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
