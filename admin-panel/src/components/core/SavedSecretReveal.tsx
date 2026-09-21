'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export type SavedSecretResult =
  | { success: true; kind: 'plaintext'; value: string }
  | { success: true; kind: 'bcrypt' }
  | { success: false; error: string };

interface SavedSecretRevealProps {
  label: string;
  canReveal: boolean;
  onReveal: () => Promise<SavedSecretResult>;
}

type ViewState = 'masked' | 'loading' | 'shown' | 'hashed';

/** Masked-by-default saved secret with click-to-reveal; the value only ever arrives via onReveal. */
export function SavedSecretReveal({ label, canReveal, onReveal }: SavedSecretRevealProps) {
  const [view, setView] = useState<ViewState>('masked');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleReveal = async (): Promise<void> => {
    if (view === 'shown' || view === 'hashed') {
      setView('masked');
      setValue('');
      return;
    }
    setView('loading');
    setError('');
    try {
      const result = await onReveal();
      if (!result.success) {
        setError(result.error);
        setView('masked');
        return;
      }
      if (result.kind === 'bcrypt') {
        setView('hashed');
        return;
      }
      setValue(result.value);
      setView('shown');
    } catch {
      setError('Unable to load secret');
      setView('masked');
    }
  };

  const open = view === 'shown' || view === 'hashed';

  return (
    <div className="space-y-2">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <div className="flex items-center gap-2">
        {view === 'shown' ? (
          <input
            type="text"
            readOnly
            value={value}
            aria-label={label}
            className="w-full px-3 py-2 bg-black/50 border border-border rounded-lg font-mono text-sm text-emerald-300 focus:outline-none"
          />
        ) : (
          <div aria-label={label} className="w-full px-3 py-2 bg-black/50 border border-border rounded-lg font-mono text-sm text-neutral-500 select-none">
            ••••••••
          </div>
        )}
        {canReveal && (
          <button
            type="button"
            onClick={() => { void handleReveal(); }}
            disabled={view === 'loading'}
            aria-label={open ? `Hide ${label}` : `Reveal ${label}`}
            className="inline-flex shrink-0 items-center gap-1 px-2 py-2 text-xs font-medium text-neutral-200 border border-border rounded-lg transition-colors hover:bg-card disabled:opacity-50"
          >
            {view === 'loading' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : open ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            {view === 'loading' ? 'Revealing…' : open ? 'Hide' : 'Reveal'}
          </button>
        )}
      </div>
      {!canReveal && (
        <p className="text-xs text-neutral-500">Read-only — you lack the reveal permission.</p>
      )}
      {view === 'hashed' && (
        <p className="text-xs text-amber-400/80">Stored hashed — irreversible. Typing a new value replaces it.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
