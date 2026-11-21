'use client';

import { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { GeneratorConfig } from '@/lib/credential-template';
import { GeneratorConfigDialog } from './GeneratorConfigDialog';
import { Button } from './Button';

export interface CredentialTemplateFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  config: GeneratorConfig;
  onConfigChange(config: GeneratorConfig): void;
  /** Clears the symbol groups for a username template drawn from USERNAME_CONFIG. */
  symbolsAllowed?: boolean;
  dialogTitle?: string;
  placeholder?: string;
  hint?: string;
}

export function CredentialTemplateField({
  label,
  value,
  onChange,
  config,
  onConfigChange,
  symbolsAllowed = true,
  dialogTitle,
  placeholder,
  hint,
}: CredentialTemplateFieldProps): React.JSX.Element {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const inputId = useId();

  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-bold text-muted-foreground uppercase mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-background/60 px-4 py-3 pr-14 font-mono text-sm text-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Settings2}
            iconOnly
            tooltip="Template options"
            onClick={() => setIsConfigOpen(true)}
          />
        </div>
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}

      <GeneratorConfigDialog
        open={isConfigOpen}
        onOpenChange={setIsConfigOpen}
        title={dialogTitle ?? `${label} options`}
        config={config}
        onConfigChange={onConfigChange}
        symbolsAllowed={symbolsAllowed}
        autoPreview
        className="sm:max-w-xl"
      />
    </div>
  );
}
