'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
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

function SectionActions({
  section,
  data,
  originalData,
  saving,
  hasPendingRestarts,
  onPersist,
}: SectionActionsProps): ReactElement {
  const showRestartButton = hasPendingRestarts && section.fields.some(f => {
    return data[section.filename]?.[f.key] !== originalData[section.filename]?.[f.key];
  });

  return (
    <div className="flex gap-2">
      <button
        onClick={() => void onPersist(section.filename, false)}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
      >
        <Save className="w-4 h-4" />
        Save Only
      </button>
      {showRestartButton && (
        <button
          onClick={() => void onPersist(section.filename, true)}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium shadow-lg shadow-indigo-900/20"
        >
          <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
          Save & Restart
        </button>
      )}
    </div>
  );
}

interface FieldRowProps {
  field: EnvConfigField;
  value: string;
  onChange: (value: string) => void;
}

function ConfigFieldRow({ field, value, onChange }: FieldRowProps): ReactElement {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-b border-white/5 pb-4 last:border-0">
      <div>
        <label className="block text-sm font-medium text-white">{field.label}</label>
        <code className="text-xs text-indigo-400 mt-1 block">{field.key}</code>
        {field.description && (
          <p className="text-xs text-neutral-500 mt-1">{field.description}</p>
        )}
      </div>
      <div className="md:col-span-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
        />
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
}

export function EnvSectionCard({
  section,
  data,
  originalData,
  saving,
  hasPendingRestarts,
  onPersist,
  onChange,
}: EnvSectionCardProps): ReactElement {
  return (
    <Card className="glass-card border-white/5 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">{section.title}</h2>
          <p className="text-neutral-400 text-sm mt-1">Editing {section.filename}</p>
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
            value={data[section.filename]?.[field.key] || ''}
            onChange={(value) => onChange(section.filename, field.key, value)}
          />
        ))}
      </div>
    </Card>
  );
}
