'use client';

import { useDictionary } from '@/hooks/useDictionary';
import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

export type StatusCardStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

export interface StatusCardProps {
  readonly title: string;
  readonly status: StatusCardStatus;
  readonly description: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly children?: React.ReactNode;
}

const STATUS_BADGE: Record<StatusCardStatus, string> = {
  healthy: 'border-success/25 bg-success/15 text-success',
  degraded: 'border-warning/25 bg-warning/15 text-warning',
  offline: 'border-destructive/25 bg-destructive/15 text-destructive',
  unknown: 'border-border bg-muted text-muted-foreground',
};

/**
 * A named subject with a verdict beside it.
 *
 * Why the status is a closed union: the badge is the whole point of the card, and
 * an open string would push the tone decision back onto every caller — which is
 * exactly the drift this card exists to remove.
 *
 * Why the verdict text is looked up here and not passed in: the four labels are
 * the primitive's own vocabulary, so a caller supplying them would let one card
 * read "Down" beside another reading "Offline" for the same state. The lookup
 * goes through the client provider rather than the server-only loader because
 * this component is rendered by client trees as well as server ones.
 */
export function StatusCard({
  title,
  status,
  description,
  icon,
  actions,
  children,
}: StatusCardProps): React.JSX.Element {
  const dictionary = useDictionary();
  return (
    <Card data-card-kind="status" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {icon !== undefined && <div className="text-muted-foreground">{icon}</div>}
        <span className="font-bold text-foreground">{title}</span>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE[status])}>
          {dictionary.states.status[status]}
        </span>
        {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="text-sm text-muted-foreground">{description}</div>
      {children !== undefined && <div className="min-w-0">{children}</div>}
    </Card>
  );
}
