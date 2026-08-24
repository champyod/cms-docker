'use client';

import { cn } from '@/lib/utils';

export const LABEL_CLASSES = 'text-xs font-bold uppercase tracking-widest text-muted-foreground';

export const FIELD_BASE =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

export const FIELD_ERROR = 'border-destructive focus-visible:ring-destructive/20';

export function fieldClasses(hasError: boolean): string {
  return cn(FIELD_BASE, hasError && FIELD_ERROR);
}

export function ErrorText({ errors, field }: { errors: Map<string, string>; field: string }) {
  if (!errors.has(field)) return null;
  return <p className="text-xs text-destructive">{errors.get(field)}</p>;
}
