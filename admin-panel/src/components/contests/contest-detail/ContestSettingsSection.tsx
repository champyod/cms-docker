'use client';

import { ToggleSwitch } from '../contest-modal/shared/ToggleSwitch';

const LABEL_CLASSES = 'mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground';
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2';

interface FormState {
  name: string; description: string; timezone: string;
  allow_questions: boolean; allow_user_tests: boolean; submissions_download_allowed: boolean;
  allow_password_authentication: boolean; allow_registration: boolean; analysis_enabled: boolean;
}

interface Props {
  formData: FormState;
  disabled?: boolean;
  canEdit?: boolean;
  onChange: (patch: Partial<FormState>) => void;
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-foreground">{label}</label>
      {disabled
        ? <ToggleSwitch checked={checked} onToggle={() => undefined} />
        : <ToggleSwitch checked={checked} onToggle={() => onChange(!checked)} />}
    </div>
  );
}

/**
 * The fields one contest settings group edits.
 *
 * Why no section card of its own: the settings layout draws each group as a card carrying the
 * group's title, description and scope, so a heading here would repeat them inside the same card.
 * Why the lock flag: a read-only caller must never meet an editable form, so either flag locks
 * every input and no false save affordance reaches the reader.
 */
export function ContestSettingsSection({ formData, disabled = false, canEdit = true, onChange }: Props): React.JSX.Element {
  const readOnly = disabled || !canEdit;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label className={LABEL_CLASSES}>Name</label>
          <input type="text" value={formData.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value })} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Description</label>
          <textarea value={formData.description} disabled={readOnly} onChange={(e) => onChange({ description: e.target.value })} rows={2} className={FIELD_CLASSES} />
        </div>
        <div>
          <label className={LABEL_CLASSES}>Timezone</label>
          <input type="text" value={formData.timezone} disabled={readOnly} onChange={(e) => onChange({ timezone: e.target.value })} placeholder="Asia/Bangkok" className={FIELD_CLASSES} />
        </div>
      </div>
      <div className="space-y-3">
        <ToggleRow label="Allow Questions" checked={formData.allow_questions} disabled={readOnly} onChange={(v) => onChange({ allow_questions: v })} />
        <ToggleRow label="Allow User Tests" checked={formData.allow_user_tests} disabled={readOnly} onChange={(v) => onChange({ allow_user_tests: v })} />
        <ToggleRow label="Allow Submissions Download" checked={formData.submissions_download_allowed} disabled={readOnly} onChange={(v) => onChange({ submissions_download_allowed: v })} />
        <ToggleRow label="Allow Password Auth" checked={formData.allow_password_authentication} disabled={readOnly} onChange={(v) => onChange({ allow_password_authentication: v })} />
        <ToggleRow label="Allow Registration" checked={formData.allow_registration} disabled={readOnly} onChange={(v) => onChange({ allow_registration: v })} />
        <ToggleRow label="Analysis Mode" checked={formData.analysis_enabled} disabled={readOnly} onChange={(v) => onChange({ analysis_enabled: v })} />
      </div>
    </div>
  );
}
