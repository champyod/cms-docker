'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
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
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void onPersist(section.filename, false)}
        disabled={saving}
        icon={Save}
      >
        Save Only
      </Button>
      {showRestartButton && (
        <Button
          size="sm"
          onClick={() => void onPersist(section.filename, true)}
          disabled={saving}
          loading={saving}
          icon={RefreshCw}
        >
          Save & Restart
        </Button>
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-b border-border pb-4 last:border-0">
      <div>
        <label className="block text-sm font-medium text-foreground">{field.label}</label>
        <code className="text-xs text-primary mt-1 block">{field.key}</code>
        {field.description && (
          <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
        )}
      </div>
      <div className="md:col-span-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full px-4 py-2 bg-card/50 border border-input rounded-lg text-foreground text-sm focus:outline-none focus:border-ring/60"
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
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
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
            value={data[section.filename]?.[field.key] || ''}
            onChange={(value) => onChange(section.filename, field.key, value)}
          />
        ))}
      </div>
    </Card>
  );
}
