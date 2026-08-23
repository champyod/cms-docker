'use client';

import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ContestFormData, SetContestForm } from '../types';

interface GeneralTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  onLanguageToggle: (lang: string) => void;
}

function NameField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Contest Name</label>
      <input
        required
        pattern="^[A-Za-z0-9_-]+$"
        title="Only letters, numbers, hyphens and underscores are allowed"
        type="text"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white focus:ring-1 transition-all font-sans",
          validationErrors.has('name')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
        placeholder="IOI 2025 Selection"
      />
      {validationErrors.has('name') && (
        <p className="text-xs text-red-500">{validationErrors.get('name')}</p>
      )}
    </div>
  );
}

function DescriptionField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Description</label>
      <textarea
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white h-32 resize-none focus:ring-1",
          validationErrors.has('description')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
      />
      {validationErrors.has('description') && (
        <p className="text-xs text-red-500">{validationErrors.get('description')}</p>
      )}
    </div>
  );
}

function StartTimeField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Start Time</label>
      <input
        required
        type="datetime-local"
        value={formData.start}
        onChange={(e) => setFormData({ ...formData, start: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white [color-scheme:dark]",
          validationErrors.has('start')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
      />
      {validationErrors.has('start') && (
        <p className="text-xs text-red-500">{validationErrors.get('start')}</p>
      )}
    </div>
  );
}

function StopTimeField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Stop Time</label>
      <input
        required
        type="datetime-local"
        value={formData.stop}
        onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white [color-scheme:dark]",
          validationErrors.has('stop')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
      />
      {validationErrors.has('stop') && (
        <p className="text-xs text-red-500">{validationErrors.get('stop')}</p>
      )}
    </div>
  );
}

function TimeFields(props: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <StartTimeField {...props} />
      <StopTimeField {...props} />
    </div>
  );
}

function TimezoneField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Timezone</label>
      <input
        required
        type="text"
        value={formData.timezone}
        onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white font-mono",
          validationErrors.has('timezone')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
      />
      {validationErrors.has('timezone') && (
        <p className="text-xs text-red-500">{validationErrors.get('timezone')}</p>
      )}
    </div>
  );
}

function LocalizationsField({
  formData,
  setFormData,
  validationErrors,
}: Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Allowed Localizations</label>
      <input
        type="text"
        value={formData.allowed_localizations}
        onChange={(e) => setFormData({ ...formData, allowed_localizations: e.target.value })}
        className={cn(
          "w-full px-4 py-3 bg-black/40 border rounded-xl text-white font-mono placeholder-white/20",
          validationErrors.has('allowed_localizations')
            ? "border-red-500 focus:ring-red-500/50"
            : "border-white/5 focus:ring-indigo-500/50"
        )}
        placeholder="en, th, etc. (Comma separated)"
      />
      {validationErrors.has('allowed_localizations') && (
        <p className="text-xs text-red-500">{validationErrors.get('allowed_localizations')}</p>
      )}
    </div>
  );
}

function LanguagesGrid({ formData, onLanguageToggle }: Pick<GeneralTabProps, 'formData' | 'onLanguageToggle'>) {
  return (
    <div className="grid grid-cols-3 gap-2 p-4 bg-black/20 rounded-xl border border-white/5 max-h-48 overflow-y-auto">
      {PROGRAMMING_LANGUAGES.map(langStr => {
        const lang = langStr;
        const isSelected = formData.languages.includes(lang);
        const displayName = langStr.split(' / ')[0].trim();
        return (
          <button
            key={lang}
            type="button"
            onClick={() => onLanguageToggle(lang)}
            className={`px-3 py-2 rounded-lg text-xs font-mono text-left transition-all ${isSelected ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-neutral-400 hover:bg-white/10'}`}
          >
            {displayName}
          </button>
        );
      })}
    </div>
  );
}

export function GeneralTab({ formData, setFormData, validationErrors, onLanguageToggle }: GeneralTabProps) {
  const fields = { formData, setFormData, validationErrors };
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* GENERAL TAB */}
      <NameField {...fields} />
      <DescriptionField {...fields} />
      <TimeFields {...fields} />
      <TimezoneField {...fields} />
      <LocalizationsField {...fields} />
      <div className="space-y-2">
        <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Allowed Languages</label>
        <LanguagesGrid formData={formData} onLanguageToggle={onLanguageToggle} />
      </div>
    </div>
  );
}
