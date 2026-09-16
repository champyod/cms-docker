'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useSyncedState } from '@/hooks/useSyncedState';
import { cn } from '@/lib/utils';
import { STATEMENT_LANGUAGES, isKnownLanguageCode, normalizeLanguageCode } from '@/lib/constants/languages';

interface LanguagePickerProps {
  value: string;
  onChange: (normalized: string) => void;
  extraOptions?: string[];
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  id?: string;
}

function buildOptions(extraOptions: string[] | undefined): Array<{ code: string; name: string }> {
  const extra = (extraOptions ?? [])
    .map((code) => normalizeLanguageCode(code))
    .filter((code) => code.length > 0);
  const extraSet = new Set(extra);
  // Why: encourage reuse of existing task languages instead of inventing en-US vs en variants
  const extraEntries = Array.from(extraSet)
    .filter((code) => !isKnownLanguageCode(code))
    .map((code) => ({ code, name: code }));
  return [...STATEMENT_LANGUAGES, ...extraEntries];
}

function filterOptions(options: Array<{ code: string; name: string }>, query: string): Array<{ code: string; name: string }> {
  const q = normalizeLanguageCode(query);
  if (!q) return options.slice(0, 50);
  const filtered = options.filter((opt) => {
    const code = opt.code.toLowerCase();
    const name = opt.name.toLowerCase();
    return code.includes(q) || name.includes(q);
  });
  return filtered.slice(0, 50);
}

export function LanguagePicker({
  value,
  onChange,
  extraOptions,
  placeholder = 'en',
  disabled = false,
  label,
  id,
}: LanguagePickerProps): React.JSX.Element {
  const [draft, setDraft] = useSyncedState<string>(value);
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => buildOptions(extraOptions), [extraOptions]);
  const filtered = useMemo(() => filterOptions(options, draft), [options, draft]);
  const normalized = useMemo(() => normalizeLanguageCode(draft), [draft]);
  const showWarning = draft.length > 0 && normalized.length > 0 && !isKnownLanguageCode(normalized);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        const next = normalizeLanguageCode(draft);
        if (next !== value) onChange(next);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [draft, value, onChange]);

  function handleSelect(code: string): void {
    const next = normalizeLanguageCode(code);
    setDraft(next);
    onChange(next);
    setOpen(false);
  }

  function handleBlur(): void {
    const next = normalizeLanguageCode(draft);
    if (next !== value) onChange(next);
    // keep draft in sync to show normalized form immediately
    setDraft(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const next = normalizeLanguageCode(draft);
      onChange(next);
      setDraft(next);
      setOpen(false);
    }
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full space-y-1.5">
      {label ? <label htmlFor={id} className="text-xs font-bold uppercase text-muted-foreground">{label}</label> : null}
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={showWarning ? true : undefined}
        className={cn(
          'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none',
          'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          showWarning ? 'border-amber-500/50 ring-amber-500/20' : ''
        )}
      />
      {showWarning ? (
        <p className="text-xs text-amber-600 ml-1">Unrecognised language code — will be saved as “{normalized}” but may not match any statement. Recognised codes come from the shared languages list (languages.json).</p>
      ) : null}
      {open ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No matches — press Enter to use “{normalized}”</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(opt.code);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <span>{opt.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{opt.code}</span>
              </button>
            ))
          )}
          {draft && !filtered.some((o) => o.code.toLowerCase() === normalized) ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(draft);
              }}
              className="w-full border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Use custom value “{normalized}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
