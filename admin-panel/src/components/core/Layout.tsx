import { cn } from '@/lib/utils';
import React, { ElementType } from 'react';

interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  direction?: 'row' | 'col';
  gap?: number | string;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
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
  const gapClass = typeof gap === 'number' ? `gap-${gap}` : `gap-[${gap}]`;
  const alignClass = align ? `items-${align}` : '';
  const justifyClass = justify ? `justify-${justify}` : '';
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
    gap?: number;
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
        <Component className={cn('grid', colsClass, `gap-${gap}`, className)} {...props}>
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
        {description && <p className="text-neutral-400">{description}</p>}
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
