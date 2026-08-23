'use client';

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
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Token Mode<InfoButton text="Tokens control how often participants can request feedback on their submissions." /></label>
        <select value={formData.token_mode} onChange={(e) => onChange({ ...formData, token_mode: e.target.value })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50">
          <option value="disabled">Disabled</option><option value="finite">Finite</option><option value="infinite">Infinite</option>
        </select>
      </div>
      {formData.token_mode === 'finite' && (
        <div className="grid grid-cols-2 gap-6 p-4 bg-white/5 rounded-xl">
          <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max Tokens</label><input type="number" value={formData.token_max_number ?? ''} onChange={(e) => onChange({ ...formData, token_max_number: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
          <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min Interval (s)</label><input type="number" value={formData.token_min_interval ?? ''} onChange={(e) => onChange({ ...formData, token_min_interval: e.target.value ? parseInt(e.target.value, 10) : null })} className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
          <div><label className="block text-xs font-bold text-indigo-400 uppercase mb-2">Initial Tokens</label><input type="number" value={formData.token_gen_initial ?? ''} onChange={(e) => onChange({ ...formData, token_gen_initial: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="2" className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
          <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Gen Amount</label><input type="number" value={formData.token_gen_number ?? ''} onChange={(e) => onChange({ ...formData, token_gen_number: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="2" className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
          <div><label className="block text-xs font-bold text-indigo-400 uppercase mb-2">Gen Interval (min)</label><input type="number" value={formData.token_gen_interval ?? ''} onChange={(e) => onChange({ ...formData, token_gen_interval: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="30" className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
          <div><label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max Gen Count</label><input type="number" value={formData.token_gen_max ?? ''} onChange={(e) => onChange({ ...formData, token_gen_max: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="Unlimited" className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50" /></div>
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
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-4">Submission Formats<InfoButton text="Required filenames. %s = Task Name, %l = Language extension." /></label>
        <div className="grid grid-cols-2 gap-3">
          {SUBMISSION_FORMATS.map((fmt) => (
            <button key={fmt} type="button" onClick={() => onToggleFormat(fmt)} className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${(formData.submission_format ?? []).includes(fmt) ? 'bg-indigo-600/20 border-indigo-500/50 text-white' : 'bg-black/30 border-white/5 text-neutral-400 hover:bg-white/5'}`}>
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${(formData.submission_format ?? []).includes(fmt) ? 'bg-indigo-500 border-indigo-500' : 'border-neutral-500'}`}>{(formData.submission_format ?? []).includes(fmt) && <div className="w-2 h-2 bg-white rounded-sm" />}</div>
              <span>{fmt}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-4">Allowed Languages</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROGRAMMING_LANGUAGES.map((lang) => {
            const displayName = lang.split(' / ')[0].trim();
            return <button key={lang} type="button" onClick={() => onToggleLanguage(lang)} className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-left truncate ${(formData.allowed_languages ?? []).includes(lang) ? 'bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/50' : 'bg-black/30 text-neutral-400 hover:bg-white/5'}`}>{displayName}</button>;
          })}
        </div>
      </div>
    </div>
  );
}
