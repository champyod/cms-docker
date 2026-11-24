import { cn } from '@/lib/utils';
import React, { ElementType } from 'react';

/** Literal class names, because Tailwind only generates a utility it can see in the source. */
const GAP_CLASSES = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  12: 'gap-12',
} as const;

export type Gap = keyof typeof GAP_CLASSES;

const ALIGN_CLASSES = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const JUSTIFY_CLASSES = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
} as const;

interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  direction?: 'row' | 'col';
  gap?: Gap;
  align?: keyof typeof ALIGN_CLASSES;
  justify?: keyof typeof JUSTIFY_CLASSES;
  wrap?: boolean;
}

export function Stack({
  as: Component = 'div',
  direction = 'col',
  gap = 4,
  align,
  justify,
  wrap = false,
  className,
  children,
  ...props
}: StackProps) {
  const directionClass = direction === 'row' ? 'flex-row' : 'flex-col';
  const gapClass = GAP_CLASSES[gap];
  const alignClass = align === undefined ? '' : ALIGN_CLASSES[align];
  const justifyClass = justify === undefined ? '' : JUSTIFY_CLASSES[justify];
  const wrapClass = wrap ? 'flex-wrap' : '';

  return (
    <Component
      className={cn('flex', directionClass, gapClass, alignClass, justifyClass, wrapClass, className)}
      {...props}
    >
      {children}
    </Component>
  );
}

interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
    as?: ElementType;
    cols?: 1 | 2 | 3 | 4 | 5 | 6 | 12;
    gap?: Gap;
}

export function Grid({
    as: Component = 'div',
    cols = 1,
    gap = 4,
    className,
    children,
    ...props
}: GridProps) {
    const colsClass = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        3: 'grid-cols-1 md:grid-cols-3',
        4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        5: 'grid-cols-2 md:grid-cols-5',
        6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
        12: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-12'
    }[cols] || 'grid-cols-1';

    return (
        <Component className={cn('grid', colsClass, GAP_CLASSES[gap], className)} {...props}>
            {children}
        </Component>
    );
}

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

// Owning the direction here keeps a consumer's flex-row from lifting the description out of the title column.
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 max-w-[80ch] flex-col gap-2">
        <h1 className="text-xl font-semibold leading-[1.35] text-foreground">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn("space-y-8", className)} {...props}>
            {children}
        </div>
    );
}
