'use client';

import { cn } from '@/lib/utils';
import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import type { TaskData } from '@/app/actions/tasks';
import { InfoButton } from './task-modal-sections';

const SUBMISSION_FORMATS = ['%s.%l', '%s.zip'];

interface TabProps {
  formData: TaskData;
  onChange: (data: TaskData) => void;
}

export function TokensTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Token Mode<InfoButton text="Tokens control how often participants can request feedback on their submissions." /></label>
        <select value={formData.token_mode} onChange={(e) => onChange({ ...formData, token_mode: e.target.value })} className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring">
          <option value="disabled">Disabled</option><option value="finite">Finite</option><option value="infinite">Infinite</option>
        </select>
      </div>
      {formData.token_mode === 'finite' && (
        <div className="grid grid-cols-2 gap-6 p-4 bg-muted/50 rounded-xl">
          <div><label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Max Tokens</label><input type="number" value={formData.token_max_number ?? ''} onChange={(e) => onChange({ ...formData, token_max_number: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
          <div><label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Min Interval (s)</label><input type="number" value={formData.token_min_interval ?? ''} onChange={(e) => onChange({ ...formData, token_min_interval: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
          <div><label className="block text-xs font-bold text-primary uppercase mb-2">Initial Tokens</label><input type="number" value={formData.token_gen_initial ?? ''} onChange={(e) => onChange({ ...formData, token_gen_initial: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="2" className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
          <div><label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Gen Amount</label><input type="number" value={formData.token_gen_number ?? ''} onChange={(e) => onChange({ ...formData, token_gen_number: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="2" className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
          <div><label className="block text-xs font-bold text-primary uppercase mb-2">Gen Interval (min)</label><input type="number" value={formData.token_gen_interval ?? ''} onChange={(e) => onChange({ ...formData, token_gen_interval: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="30" className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
          <div><label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Max Gen Count</label><input type="number" value={formData.token_gen_max ?? ''} onChange={(e) => onChange({ ...formData, token_gen_max: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="Unlimited" className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:border-ring" /></div>
        </div>
      )}
    </div>
  );
}

interface LanguagesTabProps extends TabProps {
  onToggleLanguage: (lang: string) => void;
  onToggleFormat: (fmt: string) => void;
}

export function LanguagesTab({ formData, onToggleLanguage, onToggleFormat }: LanguagesTabProps): React.JSX.Element {
  return (
    <div className="space-y-8">
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-4">Submission Formats<InfoButton text="Required filenames. %s = Task Name, %l = Language extension." /></label>
        <div className="grid grid-cols-2 gap-3">
          {SUBMISSION_FORMATS.map((fmt) => {
            const active = (formData.submission_format ?? []).includes(fmt);
            return (
              <button key={fmt} type="button" onClick={() => onToggleFormat(fmt)} className={cn('flex items-center gap-3 rounded-lg border p-3 text-left transition-all', active ? 'border-ring/50 bg-primary/10 text-foreground' : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50')}>
                <div className={cn('flex h-4 w-4 items-center justify-center rounded border', active ? 'border-primary bg-primary' : 'border-muted-foreground/40')}>{active && <div className="h-2 w-2 rounded-sm bg-card" />}</div>
                <span>{fmt}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-4">Allowed Languages</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROGRAMMING_LANGUAGES.map((lang) => {
            const displayName = lang.split(' / ')[0].trim();
            const active = (formData.allowed_languages ?? []).includes(lang);
            return (
              <button key={lang} type="button" onClick={() => onToggleLanguage(lang)} className={cn('truncate rounded-lg px-3 py-2 text-left text-xs font-medium transition-all', active ? 'bg-success/10 text-success ring-1 ring-success/50' : 'bg-muted/30 text-muted-foreground hover:bg-muted/50')}>
                {displayName}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
