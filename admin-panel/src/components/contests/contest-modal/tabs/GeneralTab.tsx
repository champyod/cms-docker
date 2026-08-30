'use client';

import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { ErrorText, fieldClasses, LABEL_CLASSES } from './fieldStyles';
import type { ContestFormData, SetContestForm } from '../types';

interface GeneralTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  onLanguageToggle: (lang: string) => void;
}

type FieldProps = Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>;

function NameField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('name');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Contest Name</label>
      <input
        required
        pattern="^[A-Za-z0-9_-]+$"
        title="Only letters, numbers, hyphens and underscores are allowed"
        type="text"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        className={fieldClasses(hasError)}
        placeholder="IOI 2025 Selection"
      />
      <ErrorText errors={validationErrors} field="name" />
    </div>
  );
}

function DescriptionField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('description');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Description</label>
      <textarea
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        className={cn(fieldClasses(hasError), 'h-32 resize-none')}
      />
      <ErrorText errors={validationErrors} field="description" />
    </div>
  );
}

function StartTimeField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('start');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Start Time</label>
      <input
        required
        type="datetime-local"
        value={formData.start}
        onChange={(e) => setFormData({ ...formData, start: e.target.value })}
        className={fieldClasses(hasError)}
      />
      <ErrorText errors={validationErrors} field="start" />
    </div>
  );
}

function StopTimeField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('stop');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Stop Time</label>
      <input
        required
        type="datetime-local"
        value={formData.stop}
        onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
        className={fieldClasses(hasError)}
      />
      <ErrorText errors={validationErrors} field="stop" />
    </div>
  );
}

function TimeFields(props: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <StartTimeField {...props} />
      <StopTimeField {...props} />
    </div>
  );
}

function TimezoneField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('timezone');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Timezone</label>
      <input
        required
        type="text"
        value={formData.timezone}
        onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
        className={cn(fieldClasses(hasError), 'font-mono')}
      />
      <ErrorText errors={validationErrors} field="timezone" />
    </div>
  );
}

function LocalizationsField({ formData, setFormData, validationErrors }: FieldProps) {
  const hasError = validationErrors.has('allowed_localizations');
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASSES}>Allowed Localizations</label>
      <input
        type="text"
        value={formData.allowed_localizations}
        onChange={(e) => setFormData({ ...formData, allowed_localizations: e.target.value })}
        className={fieldClasses(hasError)}
        placeholder="en, th, etc. (Comma separated)"
      />
      <ErrorText errors={validationErrors} field="allowed_localizations" />
    </div>
  );
}

function LanguagesGrid({ formData, onLanguageToggle }: Pick<GeneralTabProps, 'formData' | 'onLanguageToggle'>) {
  return (
    <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-4">
      {PROGRAMMING_LANGUAGES.map(langStr => {
        const lang = langStr;
        const isSelected = formData.languages.includes(lang);
        const displayName = langStr.split(' / ')[0].trim();
        return (
          <button
            key={lang}
            type="button"
            onClick={() => onLanguageToggle(lang)}
            className={cn(
              'rounded-lg px-3 py-2 text-left font-mono text-xs transition-colors',
              isSelected
                ? 'border border-success/30 bg-success/10 text-success'
                : 'bg-muted/30 text-muted-foreground hover:bg-muted'
            )}
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
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      {/* GENERAL TAB */}
      <NameField {...fields} />
      <DescriptionField {...fields} />
      <TimeFields {...fields} />
      <TimezoneField {...fields} />
      <LocalizationsField {...fields} />
      <div className="space-y-2">
        <label className={LABEL_CLASSES}>Allowed Languages</label>
        <LanguagesGrid formData={formData} onLanguageToggle={onLanguageToggle} />
      </div>
    </div>
  );
}
