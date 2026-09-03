'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PasswordFieldWithGenerator } from './PasswordFieldWithGenerator';
import { cn } from '@/lib/utils';
import type { PasswordKind } from '@/lib/password-format';

export interface PasswordRevealState {
  state: 'none' | 'plaintext' | 'bcrypt';
  value?: string;
  loading?: boolean;
}

export interface RevealProps extends PasswordRevealState {
  onReveal(): void;
}

interface PasswordFieldWithKindProps {
  label: string;
  value: string;
  onChange(value: string): void;
  kind: PasswordKind;
  onKind(kind: PasswordKind): void;
  required?: boolean;
  reveal?: RevealProps;
  placeholder?: string;
}

const KIND_OPTIONS: ReadonlyArray<{ value: PasswordKind; label: string }> = [
  { value: 'bcrypt', label: 'bcrypt (hashed)' },
  { value: 'plaintext', label: 'plain text' },
];

export function PasswordKindSelector({
  kind,
  onKind,
}: {
  kind: PasswordKind;
  onKind(kind: PasswordKind): void;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 bg-black/60 border border-border rounded-lg"
      role="group"
      aria-label="Password storage format"
    >
      {KIND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={kind === option.value}
          onClick={() => onKind(option.value)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
            kind === option.value
              ? 'bg-indigo-500/20 text-indigo-300 shadow-sm shadow-indigo-500/20'
              : 'text-neutral-500 hover:text-neutral-300'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PasswordFieldWithKind({
  label,
  value,
  onChange,
  kind,
  onKind,
  required,
  reveal,
  placeholder,
}: PasswordFieldWithKindProps) {
  const [isRevealedVisible, setIsRevealedVisible] = useState(false);

  const handleRevealClick = (): void => {
    if (isRevealedVisible) {
      setIsRevealedVisible(false);
      return;
    }
    reveal?.onReveal();
    setIsRevealedVisible(true);
  };

  return (
    <div className="space-y-2">
      <PasswordFieldWithGenerator
        label={label}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-neutral-500">Storage</span>
        <PasswordKindSelector kind={kind} onKind={onKind} />
        {reveal?.state === 'plaintext' && (
          <button
            type="button"
            onClick={handleRevealClick}
            disabled={reveal.loading}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-card hover:bg-card text-neutral-200 border border-border rounded-lg transition-colors disabled:opacity-50"
          >
            {isRevealedVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {reveal.loading ? 'Revealing…' : isRevealedVisible ? 'Hide' : 'Reveal'}
          </button>
        )}
      </div>
      {reveal?.state === 'bcrypt' && (
        <p className="text-xs text-amber-400/80">
          Stored as bcrypt — irreversible. Typing replaces it.
        </p>
      )}
      {reveal?.state === 'plaintext' && isRevealedVisible && !reveal.loading && (
        <input
          type="text"
          readOnly
          value={reveal.value ?? ''}
          aria-label="Current password"
          className="w-full px-3 py-2 bg-black/50 border border-border rounded-lg font-mono text-sm text-emerald-300 focus:outline-none"
        />
      )}
    </div>
  );
}
