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

interface StatusAppearance {
  readonly label: string;
  readonly badge: string;
}

const STATUS_APPEARANCE: Record<StatusCardStatus, StatusAppearance> = {
  healthy: { label: 'Healthy', badge: 'border-success/25 bg-success/15 text-success' },
  degraded: { label: 'Degraded', badge: 'border-warning/25 bg-warning/15 text-warning' },
  offline: { label: 'Offline', badge: 'border-destructive/25 bg-destructive/15 text-destructive' },
  unknown: { label: 'Unknown', badge: 'border-border bg-muted text-muted-foreground' },
};

/**
 * A named subject with a verdict beside it.
 *
 * Why the status is a closed union: the badge is the whole point of the card, and
 * an open string would push the tone decision back onto every caller — which is
 * exactly the drift this card exists to remove.
 */
export function StatusCard({
  title,
  status,
  description,
  icon,
  actions,
  children,
}: StatusCardProps): React.JSX.Element {
  const appearance = STATUS_APPEARANCE[status];
  return (
    <Card data-card-kind="status" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {icon !== undefined && <div className="text-muted-foreground">{icon}</div>}
        <span className="font-bold text-foreground">{title}</span>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', appearance.badge)}>
          {appearance.label}
        </span>
        {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="text-sm text-muted-foreground">{description}</div>
      {children !== undefined && <div className="min-w-0">{children}</div>}
    </Card>
  );
}
