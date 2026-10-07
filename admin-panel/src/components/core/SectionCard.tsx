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
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * Collapsible detail section.
 *
 * Why expansion stays with the owner: a section can be collapsed on mount or
 * forced open by a parent, so core renders the state it is given and reports
 * toggles rather than holding a second copy of it.
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
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {icon}
          <span className="font-bold text-foreground">{title}</span>
          {count !== undefined && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">({count})</span>
          )}
          {description}
        </button>
        <div
          className="flex shrink-0 items-center gap-3"
          onClick={(event): void => event.stopPropagation()}
        >
          {actions}
          <span className="text-muted-foreground">
            {expanded ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
          </span>
        </div>
      </div>
      {expanded && <div id={bodyId}>{children}</div>}
    </Card>
  );
}
