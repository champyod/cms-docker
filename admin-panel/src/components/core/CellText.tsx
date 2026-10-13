'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type CellTextWidth = 'id' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface CellTextProps {
  /** Text content to render. */
  readonly children: React.ReactNode;
  /**
   * Predefined semantic max-width constraint to prevent table blowout:
   * - id: max-w-[3.5rem]
   * - sm: max-w-[8rem]
   * - md: max-w-[14rem]
   * - lg: max-w-[20rem]
   * - xl: max-w-[28rem]
   * - full: max-w-full
   */
  readonly width?: CellTextWidth;
  /** Secondary or muted text style. */
  readonly muted?: boolean;
  /** Monospace font with tabular figures (ideal for IDs and numbers). */
  readonly mono?: boolean;
  /** Bold font weight. */
  readonly bold?: boolean;
  /** Additional custom class names. */
  readonly className?: string;
  /** Custom hover title override (defaults to string representation of children). */
  readonly title?: string;
}

const WIDTH_CLASSES: Record<CellTextWidth, string> = {
  id: 'max-w-[3.5rem]',
  sm: 'max-w-[8rem]',
  md: 'max-w-[14rem]',
  lg: 'max-w-[20rem]',
  xl: 'max-w-[28rem]',
  full: 'max-w-full',
};

/**
 * Truncating text container for table cells.
 * Enforces fluid column layout and prevents table blowout with accessible hover tooltips.
 */
export function CellText({
  children,
  width = 'md',
  muted = false,
  mono = false,
  bold = false,
  className,
  title,
}: CellTextProps): React.JSX.Element {
  const tooltipText =
    title ??
    (typeof children === 'string' || typeof children === 'number'
      ? String(children)
      : undefined);

  return (
    <span
      className={cn(
        'inline-block truncate min-w-0 align-middle',
        WIDTH_CLASSES[width],
        muted && 'text-muted-foreground',
        mono && 'font-mono text-xs tabular-nums',
        bold && 'font-bold',
        className,
      )}
      title={tooltipText}
    >
      {children}
    </span>
  );
}
