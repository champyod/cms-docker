'use client';

import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Textarea } from '@/components/core/Textarea';
import { cn } from '@/lib/utils';
import { LABEL_CLASSES } from './fieldStyles';
import type { ContestFormData, SetContestForm } from '../types';

interface GeneralTabProps {
  formData: ContestFormData;
  setFormData: SetContestForm;
  validationErrors: Map<string, string>;
  onLanguageToggle: (lang: string) => void;
}

type FieldProps = Pick<GeneralTabProps, 'formData' | 'setFormData' | 'validationErrors'>;

function NameField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Input
      required
      pattern="^[A-Za-z0-9_-]+$"
      title="Only letters, numbers, hyphens and underscores are allowed"
      type="text"
      label="Contest Name"
      value={formData.name}
      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
      error={validationErrors.get('name')}
      placeholder="IOI 2025 Selection"
    />
  );
}

function DescriptionField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Textarea
      label="Description"
      value={formData.description}
      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
      error={validationErrors.get('description')}
      className="h-32 resize-none"
    />
  );
}

function StartTimeField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Input
      required
      type="datetime-local"
      label="Start Time"
      value={formData.start}
      onChange={(e) => setFormData({ ...formData, start: e.target.value })}
      error={validationErrors.get('start')}
    />
  );
}

function StopTimeField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Input
      required
      type="datetime-local"
      label="Stop Time"
      value={formData.stop}
      onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
      error={validationErrors.get('stop')}
    />
  );
}

function TimeFields(props: FieldProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <StartTimeField {...props} />
      <StopTimeField {...props} />
    </div>
  );
}

function TimezoneField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Input
      required
      type="text"
      label="Timezone"
      value={formData.timezone}
      onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
      error={validationErrors.get('timezone')}
      className="font-mono"
    />
  );
}

function LocalizationsField({ formData, setFormData, validationErrors }: FieldProps): React.JSX.Element {
  return (
    <Input
      type="text"
      label="Allowed Localizations"
      value={formData.allowed_localizations}
      onChange={(e) => setFormData({ ...formData, allowed_localizations: e.target.value })}
      error={validationErrors.get('allowed_localizations')}
      placeholder="en, th, etc. (Comma separated)"
    />
  );
}

function LanguagesGrid({ formData, onLanguageToggle }: Pick<GeneralTabProps, 'formData' | 'onLanguageToggle'>): React.JSX.Element {
  return (
    <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-3">
      {PROGRAMMING_LANGUAGES.map((langStr: string) => {
        const isSelected = formData.languages.includes(langStr);
        return (
          <Button
            key={langStr}
            variant={isSelected ? 'secondary' : 'ghost'}
            aria-pressed={isSelected}
            onClick={() => onLanguageToggle(langStr)}
            className="h-auto min-h-0 justify-start rounded-lg px-3 py-2 font-mono text-xs"
          >
            {langStr}
          </Button>
        );
      })}
    </div>
  );
}

export function GeneralTab({ formData, setFormData, validationErrors, onLanguageToggle }: GeneralTabProps): React.JSX.Element {
  const fields = { formData, setFormData, validationErrors };
  return (
    <div className="animate-in fade-in slide-in-from-right-4 space-y-6 duration-300">
      <NameField {...fields} />
      <DescriptionField {...fields} />
      <TimeFields {...fields} />
      <TimezoneField {...fields} />
      <LocalizationsField {...fields} />
      <div className="space-y-2">
        <label className={cn('block', LABEL_CLASSES)}>Allowed Languages</label>
        <LanguagesGrid formData={formData} onLanguageToggle={onLanguageToggle} />
      </div>
    </div>
  );
}
