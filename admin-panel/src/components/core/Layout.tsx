import { cn } from '@/lib/utils';
import React, { ElementType } from 'react';

/**
 * The spacing ladder this panel allows, as literal class names.
 *
 * WHY literal: Tailwind generates a utility it can see in the source. `gap-${gap}` is not a class
 * it can see, so the spacing only appeared when some unrelated file happened to use the same
 * number — and disappeared the day that file changed. The same trap applied to `items-${align}`
 * and `justify-${justify}`. A map makes the allowed scale explicit, keeps every class visible to
 * the compiler, and turns an unsupported value into a type error instead of a silent no-op.
 */
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

// Why the layout lives here and not in a caller-supplied className: the title and its
// description are one column that must stay stacked, while the actions sit beside the title.
// Owning the direction here keeps `flex-row` from being merged onto the container by a
// consumer, which would lift the description out of the title column. `items-start` keeps the
// actions on the title's top edge when the title column is the taller of the two.
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
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
