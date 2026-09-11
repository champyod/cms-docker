'use client';

import { Lock } from 'lucide-react';
import type { FieldAccess } from '@/lib/field-permissions';

export interface RestrictedFieldProps extends FieldAccess {
  label: string;
  children: React.ReactNode;
  lockHint?: string;
}

/** Conditionally renders a field based on read/write access — omitted from DOM entirely when unreadable. */
export function RestrictedField({ canRead, canUpdate, label, children, lockHint }: RestrictedFieldProps) {
  if (!canRead) return null;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase">
        {label}
        {canRead && !canUpdate && <Lock className="w-3 h-3 text-muted-foreground/60" />}
      </label>
      <div className={canRead && !canUpdate ? 'opacity-60 pointer-events-none' : undefined}>
        {children}
      </div>
      {canRead && !canUpdate && lockHint && (
        <p className="text-[11px] text-muted-foreground/70">{lockHint}</p>
      )}
    </div>
  );
}
