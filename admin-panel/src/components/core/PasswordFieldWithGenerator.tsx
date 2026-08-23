'use client';

import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from '@/components/providers/ToastProvider';

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
      {label ? <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">{label}</label> : null}
      <div className="relative">
        <input
          required={required}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-3 bg-black/80 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 pr-28"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Copy"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowPassword((old) => !old)}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            title={showPassword ? 'Hide' : 'Reveal'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setIsGeneratorOpen(true)}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Generate"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      {hint && <p className="text-xs text-neutral-500 mt-1">{hint}</p>}

      <Modal
        isOpen={isGeneratorOpen}
        onClose={() => setIsGeneratorOpen(false)}
        title="Generate Password"
        className="max-w-xl max-h-[85vh] overflow-y-auto"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Length</label>
            <input
              type="number"
              min={4}
              max={128}
              value={length}
              onChange={(event) => setLength(Math.max(4, Math.min(128, Number(event.target.value) || 8)))}
              className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-white/10">
              <span className="text-sm text-white">Letters</span>
              <input type="checkbox" checked={includeLetters} onChange={(event) => setIncludeLetters(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-white/10">
              <span className="text-sm text-white">Numbers</span>
              <input type="checkbox" checked={includeNumbers} onChange={(event) => setIncludeNumbers(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-white/10 sm:col-span-2">
              <span className="text-sm text-white">Special symbols (@ # $ % ...)</span>
              <input
                type="checkbox"
                checked={includeSpecialSymbols}
                onChange={(event) => setIncludeSpecialSymbols(event.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-white/10 sm:col-span-2">
              <span className="text-sm text-white">Operator symbols (- + = _ [ ] ?)</span>
              <input
                type="checkbox"
                checked={includeOperatorSymbols}
                onChange={(event) => setIncludeOperatorSymbols(event.target.checked)}
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Letter Case</label>
            <select
              value={caseMode}
              onChange={(event) => setCaseMode(event.target.value as CaseMode)}
              disabled={!includeLetters}
              className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white disabled:opacity-50"
            >
              <option value="both">Both Upper + Lower</option>
              <option value="upper">Upper Only</option>
              <option value="lower">Lower Only</option>
            </select>
          </div>

          <div className="p-3 bg-black/50 border border-white/10 rounded-lg break-all text-sm text-indigo-300 min-h-11">
            {generated || 'Press Generate to preview password'}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={generatePassword}
              className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg"
              disabled={!charset.length}
            >
              Generate
            </button>
            <button
              type="button"
              onClick={() => {
                if (generated) onChange(generated);
                setIsGeneratorOpen(false);
              }}
              className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
              disabled={!generated}
            >
              Use Password
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
