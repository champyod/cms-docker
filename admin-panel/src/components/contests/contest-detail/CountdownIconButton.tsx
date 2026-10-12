'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

const ICON_BUTTON_CLASSES =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-input bg-transparent px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  hasPopup?: boolean;
  expanded?: boolean;
}

/** Toolbar button wrapping a lucide-animated icon, which renders a div rather than an svg. */
export const CountdownIconButton = memo(function CountdownIconButton({
  label,
  onClick,
  children,
  className,
  hasPopup,
  expanded,
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={hasPopup ? 'listbox' : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      className={cn(ICON_BUTTON_CLASSES, className)}
    >
      {children}
    </button>
  );
});
