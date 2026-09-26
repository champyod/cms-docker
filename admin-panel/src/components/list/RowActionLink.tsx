'use client';

import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface RowActionLinkProps {
  readonly href: string;
  /** Doubles as the accessible name and the tooltip, so both stay in one place. */
  readonly label: string;
  readonly icon: ReactNode;
  /** Marks the control the j/k shortcut handler activates for its row. */
  readonly isPrimary?: boolean;
  readonly className?: string;
}

// Why the ghost treatment: it is the look every row action already shares, so a
// link row action and a button row action stay indistinguishable side by side.
// Why one anchor: a real <button> nested in an <a> announces as two controls
// and swallows modified clicks, so the destination lives on the anchor itself.
const ROW_ACTION_CLASSES = [
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-medium',
  'text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
  'dark:hover:bg-accent/50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
].join(' ');

export function RowActionLink({
  href,
  label,
  icon,
  isPrimary = false,
  className,
}: RowActionLinkProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          aria-label={label}
          data-shortcut-primary={isPrimary ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          className={cn(ROW_ACTION_CLASSES, className)}
        >
          {icon}
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
