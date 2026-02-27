import { cn } from '@/lib/utils';
import React, { ElementType } from 'react';

// --- Stack Component ---
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

// --- Grid Component ---
interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
    as?: ElementType;
    cols?: 1 | 2 | 3 | 4 | 5 | 6 | 12; // Add common col counts
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
        5: 'grid-cols-5',
        6: 'grid-cols-6',
        12: 'grid-cols-12'
    }[cols] || 'grid-cols-1';

    return (
        <Component className={cn('grid', colsClass, `gap-${gap}`, className)} {...props}>
            {children}
        </Component>
    );
}

// --- PageHeader Component ---
interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center justify-between">
             <h1 className="text-3xl font-bold tracking-tight text-white">
                {title}
            </h1>
            {actions && <div>{actions}</div>}
        </div>
      {description && (
        <p className="text-neutral-400">
          {description}
        </p>
      )}
    </div>
  );
}

// --- Container/Section Component ---
interface SectionProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string;
}

export function PageContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn("space-y-8", className)} {...props}>
            {children}
        </div>
    );
}
