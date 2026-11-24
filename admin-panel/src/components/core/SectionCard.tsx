'use client';

import { useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { cn } from '@/lib/utils';

export interface SectionCardProps {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly count?: number;
  /** What this section answers, when the title alone would leave it ambiguous. */
  readonly description?: React.ReactNode;
  /** A promise about the section: who a change reaches, what a save covers. */
  readonly note?: React.ReactNode;
  /** Present together with `onToggle` to make the section collapsible; absent for a plain section. */
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/** The count and description stay out of the heading: anything inside joins its accessible name. */
export function SectionCard({
  title,
  icon,
  count,
  description,
  note,
  expanded,
  onToggle,
  actions,
  children,
  className,
}: SectionCardProps): React.JSX.Element {
  const bodyId = useId();
  const collapsible = expanded !== undefined && onToggle !== undefined;
  const bodyVisible = collapsible ? expanded : true;

  const titleNode = (
    <Text as="h2" variant="h3">
      {title}
    </Text>
  );

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div
        className={cn(
          'flex items-start justify-between gap-4 p-4',
          collapsible && 'transition-colors hover:bg-muted/50',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={bodyId}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              {icon}
              {titleNode}
              <span className="text-muted-foreground">
                {expanded ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              {titleNode}
            </div>
          )}
          {(count !== undefined || description || note) && (
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              {count !== undefined && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
                  ({count})
                </span>
              )}
              {description}
              {note && <p className="text-xs text-muted-foreground">{note}</p>}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
      {bodyVisible && (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </Card>
  );
}
