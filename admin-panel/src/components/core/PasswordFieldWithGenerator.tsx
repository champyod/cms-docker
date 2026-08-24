'use client';

import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useToast } from '@/components/providers/ToastProvider';
import { cn } from '@/lib/utils';

type CaseMode = 'both' | 'upper' | 'lower';

interface PasswordFieldWithGeneratorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

function randomFrom(chars: string): string {
  const randomValues = new Uint32Array(1);
  crypto.getRandomValues(randomValues);
  return chars[randomValues[0] % chars.length];
}

function buildLetters(caseMode: CaseMode): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (caseMode === 'upper') return upper;
  if (caseMode === 'lower') return lower;
  return lower + upper;
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
  const { addToast } = useToast();

  const [length, setLength] = useState(8);
  const [includeLetters, setIncludeLetters] = useState(true);
  const [caseMode, setCaseMode] = useState<CaseMode>('both');
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSpecialSymbols, setIncludeSpecialSymbols] = useState(true);
  const [includeOperatorSymbols, setIncludeOperatorSymbols] = useState(true);
  const [generated, setGenerated] = useState('');

  const charset = useMemo(() => {
    let chars = '';
    const specialSymbols = '@#$%^&*!~';
    const operatorSymbols = '-+=_[]?';

    if (includeLetters) chars += buildLetters(caseMode);
    if (includeNumbers) chars += '0123456789';
    if (includeSpecialSymbols) chars += specialSymbols;
    if (includeOperatorSymbols) chars += operatorSymbols;
    return chars;
  }, [includeLetters, includeNumbers, includeSpecialSymbols, includeOperatorSymbols, caseMode]);

  const generatePassword = () => {
    if (!charset.length) return;
    let result = '';
    for (let index = 0; index < length; index += 1) {
      result += randomFrom(charset);
    }
    setGenerated(result);
  };

  const handleCopy = async () => {
    if (!value) return;

    const fallbackCopy = () => {
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
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        addToast({ type: 'success', title: 'Copied', message: 'Password copied to clipboard.' });
        return;
      }

      if (fallbackCopy()) {
        addToast({ type: 'success', title: 'Copied', message: 'Password copied to clipboard.' });
      } else {
        addToast({ type: 'error', title: 'Copy failed', message: 'Unable to copy password. Please copy manually.' });
      }
    } catch {
      const success = fallbackCopy();
      if (success) {
        addToast({ type: 'success', title: 'Copied', message: 'Password copied to clipboard.' });
      } else {
        addToast({ type: 'error', title: 'Copy failed', message: 'Unable to copy password. Please copy manually.' });
      }
    }
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
          className="w-full rounded-lg border border-border bg-background/60 px-4 py-3 pr-28 text-foreground focus:border-ring focus:outline-none"
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

      <Dialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        title="Generate Password"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={generatePassword} disabled={!charset.length}>
              Generate
            </Button>
            <Button
              type="button"
              variant="positive"
              disabled={!generated}
              onClick={() => {
                if (generated) onChange(generated);
                setIsGeneratorOpen(false);
              }}
            >
              Use Password
            </Button>
          </>
        }
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Length</label>
            <input
              type="number"
              min={4}
              max={128}
              value={length}
              onChange={(event) => setLength(Math.max(4, Math.min(128, Number(event.target.value) || 8)))}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-foreground"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-sm text-foreground">Letters</span>
              <input type="checkbox" checked={includeLetters} onChange={(event) => setIncludeLetters(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
              <span className="text-sm text-foreground">Numbers</span>
              <input type="checkbox" checked={includeNumbers} onChange={(event) => setIncludeNumbers(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 sm:col-span-2">
              <span className="text-sm text-foreground">Special symbols (@ # $ % ...)</span>
              <input
                type="checkbox"
                checked={includeSpecialSymbols}
                onChange={(event) => setIncludeSpecialSymbols(event.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 sm:col-span-2">
              <span className="text-sm text-foreground">Operator symbols (- + = _ [ ] ?)</span>
              <input
                type="checkbox"
                checked={includeOperatorSymbols}
                onChange={(event) => setIncludeOperatorSymbols(event.target.checked)}
              />
            </label>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Letter Case</label>
            <select
              value={caseMode}
              onChange={(event) => setCaseMode(event.target.value as CaseMode)}
              disabled={!includeLetters}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-foreground disabled:opacity-50"
            >
              <option value="both">Both Upper + Lower</option>
              <option value="upper">Upper Only</option>
              <option value="lower">Lower Only</option>
            </select>
          </div>

          <div className={cn('min-h-11 break-all rounded-lg border border-border bg-muted/50 p-3 text-sm text-primary')}>
            {generated || 'Press Generate to preview password'}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
