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
  /**
   * A promise about the section rather than a description of it - who a change reaches, what a save
   * covers. Settings groups need it; a board section rarely does.
   */
  readonly note?: React.ReactNode;
  /** Present together with `onToggle` to make the section collapsible; absent for a plain section. */
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * One section of a page: its title, what it answers, its own actions and its content, inside the
 * card the panel uses for a section.
 *
 * The heading level and the title's size live here, so a section title cannot be an h3 on one page
 * and an h2 on the next - and the collapsible and plain modes cannot disagree about it either.
 *
 * The heading carries the title and nothing else. The count and the description are siblings of the
 * heading, because anything inside it joins its accessible name: a reader navigating by headings
 * would otherwise hear "Statements (12) No statements uploaded yet" as the name of the section.
 *
 * The body owns its padding. The header already pays for the top, so content never sits flush
 * against the card edge and no caller has to compensate for it.
 */
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
                <span className="rounded-full bg-accent px-2 py-0.5 text-[length:var(--text-label)] text-muted-foreground">
                  ({count})
                </span>
              )}
              {description}
              {note && <p className="text-[length:var(--text-label)] text-muted-foreground">{note}</p>}
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
