'use client';

import { useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

export interface SectionCardProps {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly count?: number;
  readonly description?: React.ReactNode;
  /** Present together with `onToggle` to make the section collapsible; absent for a plain section. */
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * One section of a page: its title, an optional line saying what it answers, its own actions and its
 * content, inside the card the panel uses for a section.
 *
 * The heading level lives here, so no page can pick its own: two pages that disagree about whether a
 * section title is an h2 or an h3 read as different depths of the same page. Collapsing is a mode of
 * this component rather than a second component, because a collapsible section and a static one are
 * the same fact with one interaction added.
 */
export function SectionCard({
  title,
  icon,
  count,
  description,
  expanded,
  onToggle,
  actions,
  children,
  className,
}: SectionCardProps): React.JSX.Element {
  const bodyId = useId();
  const collapsible = expanded !== undefined && onToggle !== undefined;
  const bodyVisible = collapsible ? expanded : true;

  const heading = (
    <>
      {icon}
      <span className="font-bold text-foreground">{title}</span>
      {count !== undefined && (
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">({count})</span>
      )}
      {description}
    </>
  );

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className={cn('flex items-center justify-between p-4', collapsible && 'transition-colors hover:bg-muted/50')}>
        {collapsible ? (
          <h2 className="flex min-w-0 flex-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={bodyId}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              {heading}
            </button>
          </h2>
        ) : (
          <h2 className="flex min-w-0 flex-1 items-center gap-3 text-base">{heading}</h2>
        )}
        <div className="flex shrink-0 items-center gap-3" onClick={(event): void => event.stopPropagation()}>
          {actions}
          {collapsible && (
            <span className="text-muted-foreground">
              {expanded ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            </span>
          )}
        </div>
      </div>
      {bodyVisible && <div id={bodyId}>{children}</div>}
    </Card>
  );
}
