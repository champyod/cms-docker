'use client';

import { useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from './Button';
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

interface SavedPasswordFieldProps {
  reveal: RevealProps;
}

/** Why the request is latched in a ref: the secret arrives once per mount, and a
 * ref keeps a Hide/Reveal pair from re-arming the fetch on every reopen. */
function useSavedPasswordReveal(reveal: RevealProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const hasRequestedRef = useRef(false);
  const isLoading = reveal.loading === true;

  const toggleReveal = (): void => {
    if (isRevealed && !isLoading) {
      setIsRevealed(false);
      return;
    }
    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      reveal.onReveal();
    }
    setIsRevealed(true);
  };

  return { isLoading, isOpen: isRevealed && !isLoading, toggleReveal };
}

function SavedPasswordField({ reveal }: SavedPasswordFieldProps) {
  const { isLoading, isOpen, toggleReveal } = useSavedPasswordReveal(reveal);

  return (
    <div className="relative">
      <input
        type={isOpen ? 'text' : 'password'}
        readOnly
        autoComplete="off"
        value={reveal.value ?? ''}
        aria-label="Current password"
        placeholder="••••••••"
        className="w-full rounded-lg border border-border bg-black/50 px-3 py-2 pr-14 font-mono text-sm text-emerald-300 focus:outline-none"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={isOpen ? EyeOff : Eye}
          iconOnly
          tooltip={isOpen ? 'Hide' : 'Reveal'}
          loading={isLoading}
          onClick={toggleReveal}
        />
      </div>
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
      </div>
      {reveal?.state === 'bcrypt' && (
        <p className="text-xs text-amber-400/80">
          Stored as bcrypt — irreversible. Typing replaces it.
        </p>
      )}
      {reveal?.state === 'plaintext' && <SavedPasswordField reveal={reveal} />}
    </div>
  );
}
