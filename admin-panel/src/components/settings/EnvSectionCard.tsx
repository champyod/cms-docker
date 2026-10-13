'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { RowActions } from '@/components/core/RowActions';
import { Save, RefreshCw } from 'lucide-react';
import {
  EnvConfigField,
  EnvConfigSection,
  EnvFilesData,
} from './envConfigSections';

interface SectionActionsProps {
  section: EnvConfigSection;
  data: EnvFilesData;
  originalData: EnvFilesData;
  saving: boolean;
  hasPendingRestarts: boolean;
  onPersist: (filename: string, shouldRestart?: boolean) => Promise<void>;
}

function hasPendingChange(section: EnvConfigSection, data: EnvFilesData, originalData: EnvFilesData): boolean {
  return section.fields.some((field) => data[section.filename]?.[field.key] !== originalData[section.filename]?.[field.key]);
}

function SectionActions({
  section,
  data,
  originalData,
  saving,
  hasPendingRestarts,
  onPersist,
}: SectionActionsProps): ReactElement {
  return (
    <RowActions
      ariaLabel={section.title}
      actions={[
        { key: 'save', label: 'Save Only', icon: Save, onClick: () => { void onPersist(section.filename, false); }, disabled: saving },
        { key: 'restart', label: 'Save & Restart', icon: RefreshCw, onClick: () => { void onPersist(section.filename, true); }, disabled: saving, loading: saving, showWhen: hasPendingRestarts && hasPendingChange(section, data, originalData) },
      ]}
    />
  );
}

interface FieldRowProps {
  field: EnvConfigField;
  value: string;
  profiles?: readonly string[];
  onChange: (value: string) => void;
}

/**
 * The options a profile field selects from, or null when the field is a plain text input. A stored
 * value the file no longer declares is prepended, so an already-selected profile the operator has
 * yet to fix still renders instead of silently disappearing from its own control.
 */
function profileOptions(
  field: EnvConfigField,
  value: string,
  profiles?: readonly string[],
): readonly string[] | null {
  if (field.control !== 'database-profile') return null;
  const known = profiles ?? [];
  return value !== '' && !known.includes(value) ? [value, ...known] : known;
}

/** The shared shape of the text input and the profile select, so the two controls look identical. */
const FIELD_CLASS = 'h-11 w-full px-4 py-2 bg-card/50 border border-input rounded-lg text-foreground text-sm focus:outline-none focus:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/50';

function ConfigFieldRow({ field, value, profiles, onChange }: FieldRowProps): ReactElement {
  const options = profileOptions(field, value, profiles);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-b border-border pb-4 last:border-0">
      <div>
        <label className="block text-sm font-medium text-foreground">{field.label}</label>
        <code className="text-xs text-primary mt-1 block">{field.key}</code>
        {field.description && (
          <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
        )}
      </div>
      <div className="md:col-span-2">
        {options === null ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className={FIELD_CLASS}
          />
        ) : (
          <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS}>
            {options.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

interface EnvSectionCardProps {
  section: EnvConfigSection;
  data: EnvFilesData;
  originalData: EnvFilesData;
  saving: boolean;
  hasPendingRestarts: boolean;
  onPersist: (filename: string, shouldRestart?: boolean) => Promise<void>;
  onChange: (filename: string, key: string, value: string) => void;
  /** The live [db_<name>] profiles, offered by any field whose control is a database profile. */
  databaseProfiles?: readonly string[];
}

export function EnvSectionCard({
  section,
  data,
  originalData,
  saving,
  hasPendingRestarts,
  onPersist,
  onChange,
  databaseProfiles,
}: EnvSectionCardProps): ReactElement {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">{section.title}</h2>
          <p className="text-muted-foreground text-sm mt-1">Editing {section.filename}</p>
        </div>
        <SectionActions
          section={section}
          data={data}
          originalData={originalData}
          saving={saving}
          hasPendingRestarts={hasPendingRestarts}
          onPersist={onPersist}
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {section.fields.map((field) => (
          <ConfigFieldRow
            key={field.key}
            field={field}
            profiles={databaseProfiles}
            value={data[section.filename]?.[field.key] || ''}
            onChange={(value) => onChange(section.filename, field.key, value)}
          />
        ))}
      </div>
    </Card>
  );
}
