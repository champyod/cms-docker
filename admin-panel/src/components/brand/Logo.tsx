import React from 'react';

import { cn } from '@/lib/utils';

/**
 * The CCYod CMS Docker mark: a container hexagon holding a light bulb whose
 * glass is a C and whose filament is an S, the idea-spark in MWIT yellow.
 *
 * Colours come from the theme tokens so the mark tracks light/dark and contrast
 * modes; the static files under assets/brand carry the fixed brand colours.
 */
export function LogoMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label="CCYod CMS Docker"
      className={cn('shrink-0', className)}
      fill="none"
    >
      <polygon
        points="64,6 114,35 114,93 64,122 14,93 14,35"
        fill="var(--primary)"
        stroke="var(--primary)"
        strokeWidth={12}
        strokeLinejoin="round"
      />
      <g transform="translate(64,58) scale(1.15) translate(-64,-58)" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 53.2,73.31 A 23,23 0 1 1 74.8,73.31" stroke="var(--primary-foreground)" strokeWidth={11} />
        <path d="M 58,81 H 70" stroke="var(--primary-foreground)" strokeWidth={6} />
        <path d="M 59.5,88.5 H 68.5" stroke="var(--primary-foreground)" strokeWidth={5} />
        <path
          d="M 71,47 C 71,42 57,42 57,48 C 57,53.5 73,52.5 73,58 C 73,64 59,64 59,59"
          stroke="var(--warning)"
          strokeWidth={4.5}
        />
      </g>
    </svg>
  );
}

/** The brand name with its descriptor, led by the CCYod wordmark. */
export function LogoWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('flex min-w-0 flex-col justify-center leading-none', className)}>
      <span className="truncate font-display text-sm font-semibold tracking-wide">
        <span className="text-primary">CC</span>Yod
      </span>
      <span className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        CMS Docker
      </span>
    </span>
  );
}
