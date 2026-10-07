'use client';

import { useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from './Button';

export type SavedSecretResult =
  | { success: true; kind: 'plaintext'; value: string }
  | { success: true; kind: 'bcrypt' }
  | { success: false; error: string };

interface SavedSecretRevealProps {
  label: string;
  canReveal: boolean;
  onReveal: () => Promise<SavedSecretResult>;
}

type SecretOutcome =
  | { kind: 'pending' }
  | { kind: 'plaintext'; value: string }
  | { kind: 'bcrypt' };

interface SecretRevealView {
  readonly outcome: SecretOutcome;
  readonly isOpen: boolean;
  readonly isLoading: boolean;
  readonly error: string;
  toggle(): void;
}

interface SecretFieldProps {
  readonly label: string;
  readonly outcome: SecretOutcome;
  readonly isOpen: boolean;
  readonly isLoading: boolean;
  readonly canReveal: boolean;
  readonly onToggle: () => void;
}

/** A rejected request becomes a failed result so the view renders one error channel. */
async function loadSecret(onReveal: () => Promise<SavedSecretResult>): Promise<SavedSecretResult> {
  return onReveal().catch((): SavedSecretResult => ({ success: false, error: 'Unable to load secret' }));
}

function toOutcome(result: Extract<SavedSecretResult, { success: true }>): SecretOutcome {
  return result.kind === 'bcrypt' ? { kind: 'bcrypt' } : { kind: 'plaintext', value: result.value };
}

/** Why the request is latched in a ref: the secret arrives once per mount, so a
 * Hide/Reveal pair must not re-request it. A failed request releases the latch so the
 * next Reveal retries. */
function useSecretReveal(onReveal: () => Promise<SavedSecretResult>): SecretRevealView {
  const [outcome, setOutcome] = useState<SecretOutcome>({ kind: 'pending' });
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const hasRequestedRef = useRef(false);

  const request = async (): Promise<void> => {
    setIsLoading(true);
    setError('');
    const result = await loadSecret(onReveal);
    setIsLoading(false);
    if (!result.success) {
      hasRequestedRef.current = false;
      setError(result.error);
      return;
    }
    setOutcome(toOutcome(result));
    setIsOpen(true);
  };

  const toggle = (): void => {
    if (isLoading) return;
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (hasRequestedRef.current) {
      setIsOpen(true);
      return;
    }
    hasRequestedRef.current = true;
    void request();
  };

  return { error, isLoading, isOpen, outcome, toggle };
}

function SecretField({ label, outcome, isOpen, isLoading, canReveal, onToggle }: SecretFieldProps): React.JSX.Element {
  const isShown = isOpen && outcome.kind === 'plaintext';
  const shownValue = outcome.kind === 'plaintext' ? outcome.value : '';

  return (
    <div className="relative">
      <input
        type={isShown ? 'text' : 'password'}
        readOnly
        autoComplete="off"
        value={isShown ? shownValue : ''}
        aria-label={label}
        placeholder="••••••••"
        className="w-full rounded-lg border border-border bg-black/50 px-3 py-2 pr-14 font-mono text-sm text-emerald-300 focus:outline-none"
      />
      {canReveal && outcome.kind !== 'bcrypt' ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={isShown ? EyeOff : Eye}
            iconOnly
            tooltip={isShown ? 'Hide' : 'Reveal'}
            loading={isLoading}
            onClick={onToggle}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Masked-by-default saved secret with click-to-reveal; the value only ever arrives via onReveal. */
export function SavedSecretReveal({ label, canReveal, onReveal }: SavedSecretRevealProps): React.JSX.Element {
  const { error, isLoading, isOpen, outcome, toggle } = useSecretReveal(onReveal);

  return (
    <div className="space-y-2">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <SecretField
        label={label}
        outcome={outcome}
        isOpen={isOpen}
        isLoading={isLoading}
        canReveal={canReveal}
        onToggle={toggle}
      />
      {!canReveal && (
        <p className="text-xs text-neutral-500">Read-only — you lack the reveal permission.</p>
      )}
      {outcome.kind === 'bcrypt' && (
        <p className="text-xs text-amber-400/80">Stored hashed — irreversible. Typing a new value replaces it.</p>
      )}
      {error !== '' && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
