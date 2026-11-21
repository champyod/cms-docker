'use client';

import { useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PASSWORD_CONFIG, type GeneratorConfig } from '@/lib/credential-template';
import { GeneratorConfigDialog } from './GeneratorConfigDialog';
import { Button } from './Button';

interface PasswordFieldWithGeneratorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

function copyViaSelection(value: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const success = document.execCommand('copy');
  document.body.removeChild(textarea);
  return success;
}

/** Reports success; the caller owns the toast copy because both paths say the same thing. */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    return copyViaSelection(value);
  } catch {
    return copyViaSelection(value);
  }
}

export function PasswordFieldWithGenerator({
  label,
  value,
  onChange,
  required,
  placeholder,
  hint,
}: PasswordFieldWithGeneratorProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [config, setConfig] = useState<GeneratorConfig>(PASSWORD_CONFIG);

  const handleCopy = async (): Promise<void> => {
    if (!value) return;
    if (await copyToClipboard(value)) {
      toast.success('Copied', { description: 'Password copied to clipboard.' });
      return;
    }
    toast.error('Copy failed', { description: 'Unable to copy password. Please copy manually.' });
  };

  return (
    <div>
      {label ? <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">{label}</label> : null}
      <div className="relative">
        <input
          required={required}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-background/60 px-4 py-3 pr-28 text-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Copy}
            iconOnly
            tooltip="Copy"
            onClick={handleCopy}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={showPassword ? EyeOff : Eye}
            iconOnly
            tooltip={showPassword ? 'Hide' : 'Reveal'}
            onClick={() => setShowPassword((old) => !old)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            iconOnly
            tooltip="Generate"
            onClick={() => setIsGeneratorOpen(true)}
          />
        </div>
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}

      <GeneratorConfigDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        title="Generate Password"
        config={config}
        onConfigChange={setConfig}
        onUse={(generated) => onChange(generated)}
        previewPlaceholder="Press Generate to preview password"
        useLabel="Use Password"
        className="sm:max-w-xl"
      />
    </div>
  );
}
