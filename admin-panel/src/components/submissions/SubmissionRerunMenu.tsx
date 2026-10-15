'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/core/Button';
import { useDictionary } from '@/hooks/useDictionary';

function RerunMenuItem({ label, onSelect }: {
  readonly label: string;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

export function SubmissionRerunMenu({ onFullRerun }: { readonly onFullRerun: () => void }): React.JSX.Element {
  const actions = useDictionary().submissions.record.actions;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setOpen(false)} />}
      <Button
        variant="negativeOutline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {actions.rerun}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={actions.rerun}
          className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <RerunMenuItem label={actions.fullRerun} onSelect={() => {
            setOpen(false);
            onFullRerun();
          }} />
        </div>
      )}
    </div>
  );
}
